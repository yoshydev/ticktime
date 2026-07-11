fn main() {
	// tauri-build の標準機構:
	// - tauri.conf.json の bundle.externalBin（../dist/ticktime-server）を解決し、
	//   target triple 付きの実体（ticktime-server-x86_64-unknown-linux-gnu）を
	//   target/{debug,release}/ に suffix なし（ticktime-server）でコピーする。
	//   これにより `cargo build` 直でもサイドカー解決が成立する。
	tauri_build::build()
}
