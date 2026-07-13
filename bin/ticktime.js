#!/usr/bin/env node
// ticktime CLI エントリポイント（薄いI/Oシェル。ロジックは lib.js に置きテスト対象とする）。
// env（TICKTIME_DB/PORT/HOST/ORIGIN）をセットしてから build/index.js を dynamic import して起動する。
import { createServer, connect } from 'node:net';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolveDbPath, resolvePort, resolveServeEnv, DEFAULT_PORT } from './lib.js';

const HELP = `ticktime - チケット別の作業時間を管理するローカルツール

Usage: ticktime [options]

Options:
  --port <n>   リッスンポート（デフォルト: ${DEFAULT_PORT}。PORT 環境変数より優先）
  --db <path>  SQLite DBファイルのパス（TICKTIME_DB 環境変数より優先）
  --open       起動後にブラウザで開く
  --help       このヘルプを表示
  --version    バージョンを表示

Environment variables:
  TICKTIME_DB  DBファイルのパス
  PORT         リッスンポート
  HOST         バインドアドレス（デフォルト: 127.0.0.1）
  ORIGIN       オリジン（デフォルト: http://localhost:<port>）
`;

let values;
try {
	({ values } = parseArgs({
		options: {
			port: { type: 'string' },
			db: { type: 'string' },
			open: { type: 'boolean', default: false },
			help: { type: 'boolean', default: false },
			version: { type: 'boolean', default: false }
		}
	}));
} catch (err) {
	console.error(err instanceof Error ? err.message : String(err));
	console.error(`Run 'ticktime --help' for usage.`);
	process.exit(1);
}

if (values.help) {
	console.log(HELP);
	process.exit(0);
}

if (values.version) {
	const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	console.log(pkg.version);
	process.exit(0);
}

// ポート・DBパス・サーバー env を解決する（DBパスは絶対パスに正規化して表示・実体を一致させる）
let port;
try {
	port = resolvePort({ portFlag: values.port, env: process.env });
} catch (err) {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
}
const dbPath = resolve(
	resolveDbPath({ dbFlag: values.db, env: process.env, platform: process.platform, home: homedir() })
);
const { host, origin, displayUrl } = resolveServeEnv({ port, env: process.env });

// ポート事前プローブ: 使用中なら明確なメッセージで終了する（プローブ後のレースは許容）
await new Promise((resolvePromise) => {
	const probe = createServer();
	probe.once('error', (err) => {
		if (err.code === 'EADDRINUSE') {
			console.error(
				`Error: port ${port} is already in use (another ticktime running?). Use --port <n> to choose another port.`
			);
			process.exit(1);
		}
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
	probe.once('listening', () => probe.close(resolvePromise));
	probe.listen(port, host);
});

// env をセットしてからサーバーを import する（build/index.js は import 時点で env を読んで listen する）
process.env.TICKTIME_DB = dbPath;
process.env.PORT = String(port);
process.env.HOST = host;
process.env.ORIGIN = origin;

const buildEntry = new URL('../build/index.js', import.meta.url);
try {
	await import(buildEntry.href);
} catch (err) {
	// build 未実施（エントリ自体が無い）の場合のみ案内する。
	// build 内部の import 失敗も ERR_MODULE_NOT_FOUND になり得るため、欠けているモジュールが
	// エントリそのものであることをメッセージ中のパスで確認する。それ以外は握りつぶさず再throw
	if (
		err &&
		err.code === 'ERR_MODULE_NOT_FOUND' &&
		typeof err.message === 'string' &&
		(err.message.includes(`'${fileURLToPath(buildEntry)}'`) ||
			err.message.includes(`'${buildEntry.href}'`))
	) {
		console.error('Error: build/index.js not found. Run `npm run build` first.');
		process.exit(1);
	}
	throw err;
}

// import 完了と listen 完了の間にはわずかな差があるため、接続可能になるのを待ってから案内を出す
// （adapter-node の `Listening on ...` より後に正しい案内URLが表示されるようにする）
await waitForListen(port, host, 2000);
console.log(`ticktime running at ${displayUrl}`);
console.log(`database: ${dbPath}`);

if (values.open) {
	// プラットフォーム別にブラウザを開く（失敗してもサーバーは起動済みなので無視）
	const [cmd, args] =
		process.platform === 'win32'
			? ['cmd', ['/c', 'start', '', displayUrl]]
			: process.platform === 'darwin'
				? ['open', [displayUrl]]
				: ['xdg-open', [displayUrl]];
	spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

/** ポートへTCP接続できるまで最大 timeoutMs 待つ（タイムアウトしても続行する）。 */
function waitForListen(port, host, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	return new Promise((done) => {
		const tryOnce = () => {
			const sock = connect({ port, host }, () => {
				sock.destroy();
				done();
			});
			sock.once('error', () => {
				sock.destroy();
				if (Date.now() < deadline) setTimeout(tryOnce, 100);
				else done();
			});
		};
		tryOnce();
	});
}
