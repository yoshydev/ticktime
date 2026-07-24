// ticktime サーバーを @yao-pkg/pkg で単一実行ファイル化するビルドスクリプト（PoC Step 1）
// 使い方: node desktop/build-server.mjs
//
// 経緯: build/index.js（adapter-node のESM出力）を pkg に直接渡す第1試行は失敗した。
//   - handler チャンク等が「トップレベル await + export 文」の組み合わせを含み、
//     pkg のESM→CJS変換が不可（警告どおり）→ 素のESMローダーに落ちるが、
//     Node のESMローダーは snapshot FS を読めず ERR_MODULE_NOT_FOUND で起動不能。
// 対策: esbuild で単一ESMファイルに束ね、末尾の export 文を除去して
//   「トップレベル await のみ（export なし）」の形にする。この形なら pkg の
//   ESM→CJS変換が通り、snapshot 上で起動できる。better-sqlite3 は external を
//   維持し、snapshot 内の node_modules から require させる（.node は初回起動時に
//   $HOME/.cache/pkg-native/ へ展開される）。
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { resolveHostPlatform } from './platform-map.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildEntry = path.join(rootDir, 'build', 'index.js');
const stagingDir = path.join(rootDir, 'desktop', 'dist', 'staging');
const bundlePath = path.join(stagingDir, 'server.mjs');
const configPath = path.join(rootDir, 'desktop', 'pkg.config.json');

// プラットフォーム導出は desktop/platform-map.mjs に集約（クロスビルド非対応の理由もそちら参照）
const plat = resolveHostPlatform('[desktop:build-server]');
// Tauri サイドカーの命名規則: <name>-<target-triple>
// Windows では <name>-<triple>.exe を厳密に要求するため .exe を明示付与する
const output = path.join(rootDir, 'desktop', 'dist', `ticktime-server-${plat.triple}${plat.exe}`);
const target = plat.pkgTarget;

function run(cmd, args, label, options = {}) {
	console.log(`[desktop:build-server] ${label}`);
	const res = spawnSync(cmd, args, { cwd: rootDir, stdio: 'inherit', ...options });
	if (res.error) {
		console.error(`[desktop:build-server] ${label} を起動できませんでした: ${res.error.message}`);
		process.exit(1);
	}
	if (res.status !== 0) {
		console.error(`[desktop:build-server] ${label} が失敗しました (exit=${res.status})`);
		process.exit(res.status ?? 1);
	}
}

const started = Date.now();

// 1. SvelteKit ビルド（古い build/ を pkg 化しないよう常に実行。--skip-svelte-build で省略可）
if (process.argv.includes('--skip-svelte-build')) {
	if (!existsSync(buildEntry)) {
		console.error('[desktop:build-server] --skip-svelte-build 指定ですが build/ がありません');
		process.exit(1);
	}
	console.log('[desktop:build-server] SvelteKit build をスキップ（--skip-svelte-build）');
} else {
	// Windows の npm は .cmd のため shell 経由でないと spawn できない
	run('npm', ['run', 'build'], 'SvelteKit build', { shell: process.platform === 'win32' });
}

const addon = path.join(rootDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
if (!existsSync(addon)) {
	console.error(`[desktop:build-server] better-sqlite3 のネイティブアドオンが見つかりません: ${addon}`);
	process.exit(1);
}

// 2. esbuild で単一ESMファイル化（better-sqlite3 は external 維持）
// .bin/esbuild はネイティブ実行ファイルで、Windows の .bin は cmd シムのため
// spawn できない。3OS共通で動く JS API（buildSync）を使う。
rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });
console.log('[desktop:build-server] esbuild バンドル');
try {
	buildSync({
		entryPoints: [buildEntry],
		bundle: true,
		platform: 'node',
		format: 'esm',
		external: ['better-sqlite3'],
		outfile: bundlePath,
		logLevel: 'info'
	});
} catch (e) {
	console.error(`[desktop:build-server] esbuild バンドル が失敗しました: ${e instanceof Error ? e.message : e}`);
	process.exit(1);
}

// 3. 末尾の export 文を除去（pkg のESM→CJS変換は「TLA+export 併存」を変換できないため）
const bundled = readFileSync(bundlePath, 'utf8');
// エントリの export 文は複数行で、esbuild は末尾にライセンスコメントを置くため
// 「ファイル末尾」ではアンカーできない。行頭 `export {` がちょうど1件であることを
// 検証してから除去し、想定外の形（0件/複数件）はエラーにして誤除去を防ぐ。
const exportPattern = /^export\s*\{[^}]*\};?\s*$/gm;
const matches = bundled.match(exportPattern) ?? [];
if (matches.length !== 1) {
	console.error(
		`[desktop:build-server] 除去対象の export 文が ${matches.length} 件見つかりました（想定は1件）。esbuild の出力形式が変わった可能性があります`
	);
	process.exit(1);
}
writeFileSync(bundlePath, bundled.replace(exportPattern, ''));

// 4. adapter-node は server.mjs 近傍の client/ を相対解決するため、隣にコピーして構造を保つ
cpSync(path.join(rootDir, 'build', 'client'), path.join(stagingDir, 'client'), { recursive: true });
const prerendered = path.join(rootDir, 'build', 'prerendered');
if (existsSync(prerendered)) {
	cpSync(prerendered, path.join(stagingDir, 'prerendered'), { recursive: true });
}

// 5. pkg で単一実行ファイル化
// .bin/pkg は Windows で cmd シムのため spawn できない。node 自身（process.execPath）で
// @yao-pkg/pkg の bin エントリ（package.json の bin フィールド: lib-es5/bin.js）を直接起動する。
const pkgBin = path.join(rootDir, 'node_modules', '@yao-pkg', 'pkg', 'lib-es5', 'bin.js');
if (!existsSync(pkgBin)) {
	console.error(
		`[desktop:build-server] pkg の bin エントリが見つかりません: ${pkgBin}（@yao-pkg/pkg の内部構成が変わった可能性があります）`
	);
	process.exit(1);
}
run(
	process.execPath,
	[pkgBin, '--config', configPath, '--target', target, '--output', output, bundlePath],
	'pkg ビルド'
);

console.log(`[desktop:build-server] 完了: ${output} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
