// ticktime デスクトップシェル (PoC Step 2)
//
// 役割:
// 1. 空きポートを確保し、サイドカー（pkg製の自己完結SvelteKitサーバー）をspawn
// 2. HTTP応答が返るまでポーリング（最大10秒）
// 3. ready後に http://localhost:<port> を表示するウィンドウを作成
// 4. アプリ終了・エラー時にサーバープロセスを確実にkill（最重要）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

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

/// `GET /` が HTTP 200 を返すまでポーリング（100ms間隔、timeoutまで）。
/// 外部crateを増やさないため std の TcpStream で簡易GETを行う。
fn wait_for_server(port: u16, timeout: Duration) -> bool {
	let deadline = Instant::now() + timeout;
	while Instant::now() < deadline {
		if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) {
			let _ = stream.set_read_timeout(Some(Duration::from_millis(1000)));
			let request = format!(
				"GET / HTTP/1.1\r\nHost: localhost:{port}\r\nConnection: close\r\n\r\n"
			);
			if stream.write_all(request.as_bytes()).is_ok() {
				// "HTTP/1.1 200" の12バイトだけ確認できれば十分
				let mut head = [0u8; 12];
				if stream.read_exact(&mut head).is_ok() && &head == b"HTTP/1.1 200" {
					return true;
				}
			}
		}
		std::thread::sleep(Duration::from_millis(100));
	}
	false
}

fn main() {
	let app = tauri::Builder::default()
		.plugin(tauri_plugin_shell::init())
		.setup(|app| {
			let port = pick_free_port()?;
			let origin = format!("http://localhost:{port}");

			let db = db_path();
			if let Some(dir) = db.parent() {
				std::fs::create_dir_all(dir)?;
			}

			let (_rx, child) = app
				.shell()
				.sidecar("ticktime-server")?
				.env("PORT", port.to_string())
				.env("HOST", "127.0.0.1")
				.env("ORIGIN", &origin)
				.env("TICKTIME_DB", db.to_string_lossy().to_string())
				.spawn()?;
			println!("[ticktime-desktop] サーバー起動: {origin} (db: {})", db.display());

			// 以後のエラー経路でも必ず kill できるよう、spawn直後に state へ登録する
			app.manage(ServerProcess(Mutex::new(Some(child))));

			if !wait_for_server(port, Duration::from_secs(10)) {
				kill_server(&app.state::<ServerProcess>());
				return Err(format!("サーバーが {origin} で10秒以内に応答しませんでした").into());
			}

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
