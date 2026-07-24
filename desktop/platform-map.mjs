// プラットフォームマップ: ホストの process.platform-process.arch から
// pkg ターゲットと Tauri の target triple を導出する（build-server.mjs / smoke-sidecar.mjs 共用）。
// 環境変数での上書きは意図的に設けない（クロスビルド非対応 — pkg の Node
// プレビルトも better-sqlite3 の .node もホストOS依存のため、各OS上で
// ネイティブビルドする前提）。
export const platformMap = {
	'linux-x64': { pkgTarget: 'node24-linux-x64', triple: 'x86_64-unknown-linux-gnu', exe: '' },
	'darwin-arm64': { pkgTarget: 'node24-macos-arm64', triple: 'aarch64-apple-darwin', exe: '' },
	'darwin-x64': { pkgTarget: 'node24-macos-x64', triple: 'x86_64-apple-darwin', exe: '' },
	'win32-x64': { pkgTarget: 'node24-win-x64', triple: 'x86_64-pc-windows-msvc', exe: '.exe' }
};

/** ホストのプラットフォームエントリを返す。未対応なら logPrefix 付きでエラー表示して exit(1) */
export function resolveHostPlatform(logPrefix) {
	const key = `${process.platform}-${process.arch}`;
	const plat = platformMap[key];
	if (!plat) {
		console.error(
			`${logPrefix} 未対応のプラットフォームです: ${key}（対応: ${Object.keys(platformMap).join(', ')}）`
		);
		process.exit(1);
	}
	return plat;
}
