// ticktime デスクトップシェル (PoC Step 2)
//
// 役割:
// 1. 空きポートを確保し、サイドカー（pkg製の自己完結SvelteKitサーバー）をspawn
// 2. /api/health が起動毎nonceをエコーするまでポーリング（最大10秒/試行）
//    ポートレース・別サービスへの誤接続は nonce 不一致として検出し、
//    新ポート + 新nonce で最大3回までリトライする
// 3. ready後に http://localhost:<port> を表示するウィンドウを作成
// 4. アプリ終了・エラー時にサーバープロセスを確実にkill（最重要）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod http_probe;

use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

use http_probe::{is_ready_response, read_response_head, ProbeResult};

/// 起動リトライの最大試行回数
const MAX_ATTEMPTS: u32 = 3;

/// 1試行あたりの readiness 待ちタイムアウト
const WAIT_TIMEOUT: Duration = Duration::from_secs(10);

/// サイドカーの子プロセス。終了時に必ず kill するため state で保持する。
struct ServerProcess(Mutex<Option<CommandChild>>);

fn kill_server(state: &ServerProcess) {
	if let Some(child) = state.0.lock().expect("ServerProcess mutex poisoned").take() {
		if let Err(e) = child.kill() {
			eprintln!("[ticktime-desktop] サーバープロセスのkillに失敗: {e}");
		}
	}
}

/// 127.0.0.1 の空きポートを取得する（bind→drop方式）
fn pick_free_port() -> std::io::Result<u16> {
	let listener = TcpListener::bind("127.0.0.1:0")?;
	let port = listener.local_addr()?.port();
	drop(listener);
	Ok(port)
}

/// PoC用DBパス: $XDG_DATA_HOME（無ければ ~/.local/share）/ticktime/poc-desktop.db
/// 開発用の data/ticktime.db とは分離する。
fn db_path() -> PathBuf {
	let base = std::env::var_os("XDG_DATA_HOME")
		.map(PathBuf::from)
		.filter(|p| p.is_absolute())
		.unwrap_or_else(|| {
			let home = std::env::var_os("HOME").expect("HOME が設定されていません");
			PathBuf::from(home).join(".local").join("share")
		});
	base.join("ticktime").join("poc-desktop.db")
}

/// readiness 待ちの失敗理由
enum WaitError {
	/// サイドカーが起動直後に終了した（ポート衝突・バイナリ不良など）
	EarlyExit,
	/// HTTP応答は返るが nonce が一致しない（別サービスに接続している）
	NonceMismatch,
	/// タイムアウトまでに ready にならなかった
	Timeout,
}

impl std::fmt::Display for WaitError {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match self {
			WaitError::EarlyExit => write!(f, "サーバープロセスが起動直後に終了しました"),
			WaitError::NonceMismatch => {
				write!(f, "nonce不一致の応答を受信しました（別サービスに接続している可能性）")
			}
			WaitError::Timeout => write!(f, "タイムアウトまでに応答がありませんでした"),
		}
	}
}

/// ログ1行の最大出力バイト数。超過分は切り詰めて「…」を付ける。
const MAX_LOG_LINE_BYTES: usize = 4096;

fn format_log_line(bytes: &[u8]) -> String {
	if bytes.len() > MAX_LOG_LINE_BYTES {
		let mut s = String::from_utf8_lossy(&bytes[..MAX_LOG_LINE_BYTES]).into_owned();
		s.push('…');
		s
	} else {
		// 行末の改行は println!/eprintln! 側で付くため落とす（二重改行防止）
		String::from_utf8_lossy(bytes).trim_end_matches(['\r', '\n']).to_owned()
	}
}

/// サイドカーのCommandEventチャネルを受信し、ログ出力と早期終了検知を行う。
/// Terminated 受信時に exited フラグを立て、wait_for_server が即座に打ち切れるようにする。
fn spawn_log_pump(mut rx: tauri::async_runtime::Receiver<CommandEvent>, exited: Arc<AtomicBool>) {
	tauri::async_runtime::spawn(async move {
		while let Some(event) = rx.recv().await {
			match event {
				CommandEvent::Stdout(line) => {
					println!("[ticktime-server] {}", format_log_line(&line));
				}
				CommandEvent::Stderr(line) => {
					eprintln!("[ticktime-server] {}", format_log_line(&line));
				}
				CommandEvent::Error(e) => {
					eprintln!("[ticktime-server] イベント受信エラー: {e}");
				}
				CommandEvent::Terminated(payload) => {
					eprintln!(
						"[ticktime-server] プロセス終了: code={:?} signal={:?}",
						payload.code, payload.signal
					);
					exited.store(true, Ordering::SeqCst);
				}
				// CommandEvent は #[non_exhaustive]（tauri-plugin-shell 2.3.5）
				_ => {}
			}
		}
	});
}

/// `GET /api/health` が 2xx かつ起動nonceをエコーするまでポーリング（100ms間隔）。
/// 外部crateを増やさないため std の TcpStream で簡易GETを行う。
fn wait_for_server(
	port: u16,
	nonce: &str,
	exited: &AtomicBool,
	timeout: Duration,
) -> Result<(), WaitError> {
	let deadline = Instant::now() + timeout;
	while Instant::now() < deadline {
		// サイドカーが既に死んでいるならタイムアウトを待たず打ち切る
		if exited.load(Ordering::SeqCst) {
			return Err(WaitError::EarlyExit);
		}
		if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) {
			// ポーリング間隔（100ms）に対して長く待ちすぎないよう短めに設定
			let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
			let request = format!(
				"GET /api/health HTTP/1.1\r\nHost: localhost:{port}\r\nConnection: close\r\n\r\n"
			);
			if stream.write_all(request.as_bytes()).is_ok() {
				if let Ok(Some(head)) = read_response_head(&mut stream) {
					match is_ready_response(&head, nonce) {
						ProbeResult::Ready => return Ok(()),
						// 別サービスの応答 → このポートで待ち続けても無駄なので即撤退
						ProbeResult::NonceMismatch => return Err(WaitError::NonceMismatch),
						ProbeResult::NotReady => {}
					}
				}
			}
		}
		std::thread::sleep(Duration::from_millis(100));
	}
	Err(WaitError::Timeout)
}

/// 1回分の起動試行: ポート確保 → nonce生成 → spawn → readiness待ち。
/// 失敗時は子プロセスをkillしてからエラー文字列を返す（呼び出し側でリトライ）。
fn try_start_server(
	app: &tauri::App,
	db: &Path,
) -> Result<(CommandChild, String), String> {
	let port = pick_free_port().map_err(|e| format!("空きポートの取得に失敗: {e}"))?;
	let origin = format!("http://localhost:{port}");
	// 起動毎に新しいnonceを生成し、/api/health のヘッダエコーで「自分が起動した
	// サーバー」であることを確認する（ポートレース・誤接続対策）
	let nonce = Uuid::new_v4().to_string();

	let (rx, child) = app
		.shell()
		.sidecar("ticktime-server")
		.map_err(|e| format!("サイドカーの準備に失敗: {e}"))?
		.env("PORT", port.to_string())
		.env("HOST", "127.0.0.1")
		.env("ORIGIN", &origin)
		.env("TICKTIME_DB", db.to_string_lossy().to_string())
		.env("TICKTIME_STARTUP_NONCE", &nonce)
		.spawn()
		.map_err(|e| format!("サイドカーのspawnに失敗: {e}"))?;
	println!("[ticktime-desktop] サーバー起動: {origin} (db: {})", db.display());

	// ログ回収 + 早期終了検知
	let exited = Arc::new(AtomicBool::new(false));
	spawn_log_pump(rx, Arc::clone(&exited));

	match wait_for_server(port, &nonce, &exited, WAIT_TIMEOUT) {
		Ok(()) => Ok((child, origin)),
		Err(e) => {
			// この試行の子プロセスはその場でkillしてから次の試行へ
			if let Err(ke) = child.kill() {
				eprintln!("[ticktime-desktop] 失敗した試行のサーバーkillに失敗: {ke}");
			}
			Err(format!("{origin} で待機中に失敗: {e}"))
		}
	}
}

fn main() {
	let app = tauri::Builder::default()
		.plugin(tauri_plugin_shell::init())
		.setup(|app| {
			let db = db_path();
			if let Some(dir) = db.parent() {
				std::fs::create_dir_all(dir)?;
			}

			// 新ポート + 新nonce で最大 MAX_ATTEMPTS 回まで起動を試みる
			let mut started: Option<(CommandChild, String)> = None;
			let mut last_err = String::new();
			for attempt in 1..=MAX_ATTEMPTS {
				match try_start_server(app, &db) {
					Ok(ok) => {
						started = Some(ok);
						break;
					}
					Err(e) => {
						eprintln!(
							"[ticktime-desktop] 起動試行 {attempt}/{MAX_ATTEMPTS} 失敗: {e}"
						);
						last_err = e;
					}
				}
			}
			let Some((child, origin)) = started else {
				// 失敗した試行の子プロセスは try_start_server 内でkill済み
				return Err(format!(
					"サーバー起動に{MAX_ATTEMPTS}回失敗しました（最後の失敗: {last_err}）"
				)
				.into());
			};

			// 以後のエラー経路（ウィンドウ作成失敗・終了イベント）でも必ず kill
			// できるよう、ready確定直後に state へ登録する
			app.manage(ServerProcess(Mutex::new(Some(child))));

			let window = WebviewWindowBuilder::new(
				app,
				"main",
				WebviewUrl::External(origin.parse()?),
			)
			.title("ticktime")
			.inner_size(1100.0, 800.0)
			.build();

			if let Err(e) = window {
				kill_server(&app.state::<ServerProcess>());
				return Err(e.into());
			}
			Ok(())
		})
		.build(tauri::generate_context!())
		.expect("Tauriアプリの初期化に失敗しました");

	app.run(|app_handle, event| match event {
		// ExitRequested（最終ウィンドウclose等）と Exit の両方でkill。
		// take() 済みなら2回目は何もしないので二重killにはならない。
		RunEvent::ExitRequested { .. } | RunEvent::Exit => {
			if let Some(state) = app_handle.try_state::<ServerProcess>() {
				kill_server(&state);
			}
		}
		_ => {}
	});
}
