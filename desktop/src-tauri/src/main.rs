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

mod db_path;
mod http_probe;

use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

use db_path::{resolve_db_path, Platform};
use http_probe::{is_ready_response, read_response_head, ProbeResult};

/// DBファイル名。debugビルドは poc-desktop.db に分離し、開発中に誤って
/// npx版と共有する実DB（ticktime.db）へ触れないよう保護する。
/// releaseビルドは npx版（bin/lib.js resolveDbPath）と同じ ticktime.db を使う。
#[cfg(debug_assertions)]
const DB_FILENAME: &str = "poc-desktop.db";
#[cfg(not(debug_assertions))]
const DB_FILENAME: &str = "ticktime.db";

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

/// `token=<英数字列>` を `token=***` にマスクする。
/// サイドカーがリクエストラインをログ出力した場合に認可トークンが
/// デスクトップ側のログへ漏れるのを防ぐ（正規表現crateを増やさず手書きスキャン）。
fn redact_token(s: &str) -> String {
	const NEEDLE: &str = "token=";
	let mut out = String::with_capacity(s.len());
	let mut rest = s;
	while let Some(pos) = rest.find(NEEDLE) {
		let after = pos + NEEDLE.len();
		out.push_str(&rest[..after]);
		let tail = &rest[after..];
		// `token=` 直後に続く英数字列がトークン本体。非英数字（& や空白等）で終端
		let token_len =
			tail.find(|c: char| !c.is_ascii_alphanumeric()).unwrap_or(tail.len());
		if token_len > 0 {
			out.push_str("***");
		}
		rest = &tail[token_len..];
	}
	out.push_str(rest);
	out
}

/// 行中の secret 完全一致出現をすべて `***` に置換する。
/// `token=` ヒューリスティック（redact_token）を通り抜ける形式
/// （JSONログ・別パラメータ名等）でも認可トークンの漏出を防ぐ最終防衛線。
/// secret が空文字なら何もしない（全文字間に `***` が挟まる事故防止）。
fn redact_secret(line: &str, secret: &str) -> String {
	if secret.is_empty() {
		return line.to_owned();
	}
	line.replace(secret, "***")
}

fn format_log_line(bytes: &[u8]) -> String {
	let s = if bytes.len() > MAX_LOG_LINE_BYTES {
		let mut s = String::from_utf8_lossy(&bytes[..MAX_LOG_LINE_BYTES]).into_owned();
		s.push('…');
		s
	} else {
		// 行末の改行は println!/eprintln! 側で付くため落とす（二重改行防止）
		String::from_utf8_lossy(bytes).trim_end_matches(['\r', '\n']).to_owned()
	};
	redact_token(&s)
}

/// サイドカーのCommandEventチャネルを受信し、ログ出力と早期終了検知を行う。
/// Terminated 受信時に exited フラグを立て、wait_for_server が即座に打ち切れるようにする。
/// auth_token はログ転送前に完全一致マスクするために受け取る（ログ出力は禁止）。
fn spawn_log_pump(
	mut rx: tauri::async_runtime::Receiver<CommandEvent>,
	exited: Arc<AtomicBool>,
	auth_token: String,
) {
	tauri::async_runtime::spawn(async move {
		while let Some(event) = rx.recv().await {
			match event {
				CommandEvent::Stdout(line) => {
					println!(
						"[ticktime-server] {}",
						redact_secret(&format_log_line(&line), &auth_token)
					);
				}
				CommandEvent::Stderr(line) => {
					eprintln!(
						"[ticktime-server] {}",
						redact_secret(&format_log_line(&line), &auth_token)
					);
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

/// 起動成功した1試行分の結果。auth_token はログ・エラー文字列に出さないこと。
struct StartedServer {
	child: CommandChild,
	origin: String,
	auth_token: String,
}

/// ブートストラップURLを組み立てる。トークンはhexのみなのでURLエンコード不要
/// （hex以外の文字を含むトークンに変更する場合はエンコード必須）。
fn build_bootstrap_url(origin: &str, auth_token: &str) -> String {
	format!("{origin}/auth?token={auth_token}")
}

/// WebViewのナビゲーション/新規ウィンドウ要求の分類結果
#[derive(Debug, PartialEq, Eq)]
enum NavDecision {
	/// アプリorigin（scheme+host+port一致）: WebView内遷移として許可
	SameOrigin,
	/// 外部の http/https（Jiraリンク・報告URL等）: OSブラウザで開く
	OpenExternal,
	/// それ以外のスキーム: 単に拒否
	Deny,
}

/// 遷移先URLをアプリoriginと比較して分類する（on_navigation / on_new_window 共通）。
/// ポートは port_or_known_default で比較し、`http://localhost:80` のような
/// ポート省略表記でも正しく判定する。
fn classify_navigation(url: &tauri::Url, app_origin: &tauri::Url) -> NavDecision {
	let same_origin = url.scheme() == app_origin.scheme()
		&& url.host() == app_origin.host()
		&& url.port_or_known_default() == app_origin.port_or_known_default();
	if same_origin {
		NavDecision::SameOrigin
	} else if matches!(url.scheme(), "http" | "https") {
		NavDecision::OpenExternal
	} else {
		NavDecision::Deny
	}
}

/// 外部URLをOSブラウザで開く（失敗してもURL自体はログに出さない）
fn open_in_os_browser(handle: &tauri::AppHandle, url: &tauri::Url) {
	// shell().open は tauri-plugin-opener への移行が推奨されているが、
	// 依存を増やさない方針のため既存の shell プラグインを使う
	#[allow(deprecated)]
	if let Err(e) = handle.shell().open(url.as_str(), None) {
		eprintln!("[ticktime-desktop] 外部ブラウザでのURLオープンに失敗: {e}");
	}
}

/// 1回分の起動試行: ポート確保 → nonce生成 → spawn → readiness待ち。
/// 失敗時は子プロセスをkillしてからエラー文字列を返す（呼び出し側でリトライ）。
fn try_start_server(app: &tauri::App, db: &Path) -> Result<StartedServer, String> {
	let port = pick_free_port().map_err(|e| format!("空きポートの取得に失敗: {e}"))?;
	let origin = format!("http://localhost:{port}");
	// 起動毎に新しいnonceを生成し、/api/health のヘッダエコーで「自分が起動した
	// サーバー」であることを確認する（ポートレース・誤接続対策）
	let nonce = Uuid::new_v4().to_string();
	// 認可トークン。nonce は /api/health で公開されるため転用不可、これは別物。
	// UUIDv4 2本の連結で約244bitのランダム性（64文字hex）。ログに出さないこと。
	let auth_token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());

	let (rx, child) = app
		.shell()
		.sidecar("ticktime-server")
		.map_err(|e| format!("サイドカーの準備に失敗: {e}"))?
		.env("PORT", port.to_string())
		.env("HOST", "127.0.0.1")
		.env("ORIGIN", &origin)
		.env("TICKTIME_DB", db.to_string_lossy().to_string())
		.env("TICKTIME_STARTUP_NONCE", &nonce)
		.env("TICKTIME_AUTH_TOKEN", &auth_token)
		.spawn()
		.map_err(|e| format!("サイドカーのspawnに失敗: {e}"))?;
	println!("[ticktime-desktop] サーバー起動: {origin} (db: {})", db.display());

	// ログ回収 + 早期終了検知（auth_token はログ転送前の完全一致マスク用）
	let exited = Arc::new(AtomicBool::new(false));
	spawn_log_pump(rx, Arc::clone(&exited), auth_token.clone());

	match wait_for_server(port, &nonce, &exited, WAIT_TIMEOUT) {
		Ok(()) => Ok(StartedServer { child, origin, auth_token }),
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
			// 実行時プラットフォームを純関数用の Platform に変換
			let platform = if cfg!(target_os = "windows") {
				Platform::Windows
			} else if cfg!(target_os = "macos") {
				Platform::MacOs
			} else {
				Platform::Linux
			};
			// TICKTIME_DB が指定されていれば home 不要でそのまま使う
			// （home 未設定の環境でも TICKTIME_DB 指定で起動できるようにする）
			let ticktime_db = std::env::var("TICKTIME_DB").ok().filter(|s| !s.is_empty());
			let resolved = if let Some(db) = ticktime_db {
				db
			} else {
				// home: Windows は USERPROFILE、それ以外は HOME。
				// 非UTF-8パスは PoC 対象外のため var() で取得する
				let home_var =
					if matches!(platform, Platform::Windows) { "USERPROFILE" } else { "HOME" };
				let Ok(home) = std::env::var(home_var) else {
					return Err(format!(
						"ホームディレクトリを特定できません（環境変数 {home_var} が未設定）"
					)
					.into());
				};
				resolve_db_path(
					None,
					std::env::var("LOCALAPPDATA").ok().as_deref(),
					std::env::var("XDG_DATA_HOME").ok().as_deref(),
					&home,
					platform,
					DB_FILENAME,
				)
			};
			// 相対パス（TICKTIME_DB で指定され得る）は絶対化してからサイドカーへ渡す
			// （npx版 bin/ticktime.js が path.resolve() するのと互換）
			let mut db = PathBuf::from(resolved);
			if db.is_relative() {
				db = std::env::current_dir()?.join(db);
			}
			if let Some(dir) = db.parent() {
				std::fs::create_dir_all(dir)?;
			}

			// 新ポート + 新nonce + 新認可トークンで最大 MAX_ATTEMPTS 回まで起動を試みる
			let mut started: Option<StartedServer> = None;
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
			let Some(StartedServer { child, origin, auth_token }) = started else {
				// 失敗した試行の子プロセスは try_start_server 内でkill済み
				return Err(format!(
					"サーバー起動に{MAX_ATTEMPTS}回失敗しました（最後の失敗: {last_err}）"
				)
				.into());
			};

			// 以後のエラー経路（ウィンドウ作成失敗・終了イベント）でも必ず kill
			// できるよう、ready確定直後に state へ登録する
			app.manage(ServerProcess(Mutex::new(Some(child))));

			// 初回ロードはブートストラップURL（/auth?token=...）。SvelteKit側が
			// トークンをCookieへ移し替えてトップへリダイレクトする。
			// このURL・トークンはログ・エラー文字列に一切出さないこと。
			let bootstrap_url = build_bootstrap_url(&origin, &auth_token);

			// アプリorigin（scheme+host+port）と一致する遷移のみWebView内で許可し、
			// 外部の http/https はOSブラウザへ委譲する（classify_navigation で判定）
			let app_origin: tauri::Url = origin.parse()?;
			let nav_origin = app_origin.clone();
			let nav_handle = app.handle().clone();
			let new_window_origin = app_origin.clone();
			let new_window_handle = app.handle().clone();
			let window = WebviewWindowBuilder::new(
				app,
				"main",
				WebviewUrl::External(bootstrap_url.parse()?),
			)
			.on_navigation(move |url| match classify_navigation(url, &nav_origin) {
				NavDecision::SameOrigin => true,
				NavDecision::OpenExternal => {
					open_in_os_browser(&nav_handle, url);
					false
				}
				NavDecision::Deny => false,
			})
			// target="_blank" や window.open は on_navigation を通らずここに来る。
			// 外部 http/https はOSブラウザへ委譲し、新規ウィンドウ生成は常に拒否する
			// （アプリは同一originの_blankを使わないため SameOrigin も拒否でよい）
			.on_new_window(move |url, _features: NewWindowFeatures| {
				if classify_navigation(&url, &new_window_origin) == NavDecision::OpenExternal {
					open_in_os_browser(&new_window_handle, &url);
				}
				NewWindowResponse::Deny
			})
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

#[cfg(test)]
mod tests {
	use super::{
		build_bootstrap_url, classify_navigation, redact_secret, redact_token, NavDecision,
	};

	#[test]
	fn redact_token_はトークンをマスクする() {
		assert_eq!(redact_token("token=abc123"), "token=***");
	}

	#[test]
	fn redact_token_は行途中のトークンもマスクする() {
		assert_eq!(
			redact_token("GET /auth?token=deadbeef01 HTTP/1.1"),
			"GET /auth?token=*** HTTP/1.1"
		);
	}

	#[test]
	fn redact_token_は複数出現をすべてマスクする() {
		assert_eq!(
			redact_token("a token=AAA1 b token=BBB2"),
			"a token=*** b token=***"
		);
	}

	#[test]
	fn redact_token_はトークン本体なしなら変更しない() {
		// `token=` 直後に英数字が続かない場合はマスク対象がない
		assert_eq!(redact_token("token="), "token=");
		assert_eq!(redact_token("token=&x=1"), "token=&x=1");
	}

	#[test]
	fn redact_token_はtokenを含まない行を変更しない() {
		let line = "[ticktime-server] listening on 127.0.0.1:5173";
		assert_eq!(redact_token(line), line);
	}

	#[test]
	fn redact_token_はクエリ区切りで終端する() {
		assert_eq!(redact_token("token=abc123&next=/"), "token=***&next=/");
	}

	#[test]
	fn redact_secret_は完全一致出現をマスクする() {
		assert_eq!(redact_secret("Bearer cafe01", "cafe01"), "Bearer ***");
	}

	#[test]
	fn redact_secret_は複数出現と行途中もマスクする() {
		assert_eq!(
			redact_secret(r#"{"a":"SEC","b":"xSECy"}"#, "SEC"),
			r#"{"a":"***","b":"x***y"}"#
		);
	}

	#[test]
	fn redact_secret_はsecretが空文字なら何もしない() {
		assert_eq!(redact_secret("abc", ""), "abc");
	}

	#[test]
	fn redact_secret_はsecretを含まない行を変更しない() {
		assert_eq!(redact_secret("listening on 127.0.0.1", "cafe01"), "listening on 127.0.0.1");
	}

	fn url(s: &str) -> tauri::Url {
		s.parse().expect("テスト用URLのparseに失敗")
	}

	#[test]
	fn classify_navigation_は同一originを許可する() {
		let origin = url("http://localhost:4321");
		assert_eq!(
			classify_navigation(&url("http://localhost:4321/history"), &origin),
			NavDecision::SameOrigin
		);
	}

	#[test]
	fn classify_navigation_はポート違いを外部として扱う() {
		let origin = url("http://localhost:4321");
		assert_eq!(
			classify_navigation(&url("http://localhost:9999/"), &origin),
			NavDecision::OpenExternal
		);
	}

	#[test]
	fn classify_navigation_は外部httpsをブラウザ委譲にする() {
		let origin = url("http://localhost:4321");
		assert_eq!(
			classify_navigation(&url("https://example.atlassian.net/browse/T-1"), &origin),
			NavDecision::OpenExternal
		);
	}

	#[test]
	fn classify_navigation_はhttp_https以外のスキームを拒否する() {
		let origin = url("http://localhost:4321");
		assert_eq!(classify_navigation(&url("mailto:a@example.com"), &origin), NavDecision::Deny);
		assert_eq!(classify_navigation(&url("file:///etc/passwd"), &origin), NavDecision::Deny);
	}

	#[test]
	fn build_bootstrap_url_は形式どおりに組み立てる() {
		assert_eq!(
			build_bootstrap_url("http://localhost:4321", "cafe0123"),
			"http://localhost:4321/auth?token=cafe0123"
		);
	}
}
