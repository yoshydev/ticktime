// サイドカーバイナリの単体スモークテスト（CI用・3OS共通）
// 使い方: node desktop/scripts/smoke-sidecar.mjs
//
// desktop/build-server.mjs で生成したサイドカーを一時DB + ランダムポートで起動し、
// /api/health が 2xx かつ起動nonce（x-ticktime-nonce ヘッダ）をエコーするまで
// ポーリングする。Tauriシェル（desktop/src-tauri/src/main.rs）と同じ起動契約を
// GUIなしで検証するのが目的。
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHostPlatform } from '../platform-map.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plat = resolveHostPlatform('[desktop:smoke]');

const sidecarPath = path.join(rootDir, 'desktop', 'dist', `ticktime-server-${plat.triple}${plat.exe}`);
if (!existsSync(sidecarPath)) {
	console.error(
		`[desktop:smoke] サイドカーバイナリが見つかりません: ${sidecarPath}（先に node desktop/build-server.mjs を実行してください）`
	);
	process.exit(1);
}

/** listen(0) でOSに空きポートを割り当てさせ、close してから番号を返す */
function pickFreePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			server.close((err) => (err ? reject(err) : resolve(port)));
		});
	});
}

const POLL_INTERVAL_MS = 500;
const TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 2_000;
const EXIT_WAIT_MS = 5_000;

const started = Date.now();
const port = await pickFreePort();
const nonce = randomUUID();
const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'ticktime-smoke-'));
const dbPath = path.join(tmpDir, 'smoke.db');

console.log(`[desktop:smoke] サイドカー起動: ${sidecarPath} (port=${port}, db=${dbPath})`);
const child = spawn(sidecarPath, [], {
	env: {
		...process.env,
		PORT: String(port),
		HOST: '127.0.0.1',
		ORIGIN: `http://127.0.0.1:${port}`,
		TICKTIME_DB: dbPath,
		TICKTIME_STARTUP_NONCE: nonce
	},
	stdio: ['ignore', 'pipe', 'pipe']
});

// サイドカーの出力を [sidecar] プレフィックスで中継
const relay = (stream, write) => {
	stream.setEncoding('utf8');
	stream.on('data', (chunk) => {
		for (const line of chunk.split('\n')) {
			if (line.trim() !== '') write(`[sidecar] ${line}`);
		}
	});
};
relay(child.stdout, (line) => console.log(line));
relay(child.stderr, (line) => console.error(line));

let childExited = false;
let finished = false;

// プロセス早期終了は即失敗（ポーリングのタイムアウトを待たない）
child.on('exit', (code, signal) => {
	childExited = true;
	if (!finished) {
		void fail(`サイドカーが早期終了しました (code=${code}, signal=${signal})`);
	}
});
// 非同期のspawn失敗（実行権限不足など）は exit が発火しないため個別に拾う
child.on('error', (err) => {
	childExited = true;
	if (!finished) {
		void fail(`サイドカーを起動できませんでした: ${err.message}`);
	}
});

/** child の exit を上限付きで待つ。時間内に終了したら true */
function waitChildExit(timeoutMs) {
	if (childExited) return Promise.resolve(true);
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(false), timeoutMs);
		child.once('exit', () => {
			clearTimeout(timer);
			resolve(true);
		});
	});
}

// kill → 終了待ち（上限あり）→ 一時ディレクトリ削除。
// Windows では終了前のプロセスが DB ファイルを掴んでいることがあるため、
// 終了を待ってからリトライ付きで削除し、削除失敗は元の結果を上書きせず警告に留める
async function cleanup() {
	if (!childExited) child.kill();
	const exited = await waitChildExit(EXIT_WAIT_MS);
	if (!exited) {
		console.error(`[desktop:smoke] サイドカーの終了を ${EXIT_WAIT_MS / 1000}秒以内に確認できませんでした`);
	}
	try {
		rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	} catch (e) {
		console.error(`[desktop:smoke] 一時ディレクトリの削除に失敗しました: ${e instanceof Error ? e.message : e}`);
	}
}

async function fail(message) {
	finished = true;
	console.error(`[desktop:smoke] ${message}`);
	await cleanup();
	process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// /api/health を 2xx + nonce一致までポーリング
while (Date.now() - started < TIMEOUT_MS) {
	try {
		// fetch 単体にもタイムアウトを付ける（応答を返さない相手だと全体タイムアウトに到達できないため）
		const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
		if (res.ok) {
			const echoed = res.headers.get('x-ticktime-nonce');
			if (echoed === nonce) {
				finished = true;
				await cleanup();
				console.log(`[desktop:smoke] smoke OK (${((Date.now() - started) / 1000).toFixed(1)}s)`);
				process.exit(0);
			}
			// 2xx だが nonce 不一致 = 別サービスに接続している。リトライしても直らないため即失敗
			await fail(`nonce が一致しません（期待=${nonce}, 実際=${echoed ?? '(なし)'}）`);
		}
	} catch {
		// 起動前の接続拒否・タイムアウトは想定内。次のポーリングまで待つ
	}
	await sleep(POLL_INTERVAL_MS);
}

await fail(`タイムアウト: ${TIMEOUT_MS / 1000}秒以内に /api/health が ready になりませんでした`);
