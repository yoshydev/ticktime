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

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// プラットフォームマップ（desktop/build-server.mjs と同一の定義。クロスビルド非対応の
// ため環境変数上書きは設けない — 検証対象はホストOSでビルドしたバイナリのみ）
const platformMap = {
	'linux-x64': { triple: 'x86_64-unknown-linux-gnu', exe: '' },
	'darwin-arm64': { triple: 'aarch64-apple-darwin', exe: '' },
	'darwin-x64': { triple: 'x86_64-apple-darwin', exe: '' },
	'win32-x64': { triple: 'x86_64-pc-windows-msvc', exe: '.exe' }
};
const platformKey = `${process.platform}-${process.arch}`;
const plat = platformMap[platformKey];
if (!plat) {
	console.error(
		`[desktop:smoke] 未対応のプラットフォームです: ${platformKey}（対応: ${Object.keys(platformMap).join(', ')}）`
	);
	process.exit(1);
}

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

// プロセス早期終了は即失敗（ポーリングのタイムアウトを待たない）
let childExited = false;
child.on('exit', (code, signal) => {
	childExited = true;
	if (!finished) {
		fail(`サイドカーが早期終了しました (code=${code}, signal=${signal})`);
	}
});

let finished = false;

function cleanup() {
	if (!childExited) child.kill();
	// Windows では終了直前のプロセスが DB ファイルを掴んでいることがあるためリトライ付きで削除
	rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

function fail(message) {
	finished = true;
	console.error(`[desktop:smoke] ${message}`);
	cleanup();
	process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// /api/health を 2xx + nonce一致までポーリング
while (Date.now() - started < TIMEOUT_MS) {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/api/health`);
		if (res.ok) {
			const echoed = res.headers.get('x-ticktime-nonce');
			if (echoed === nonce) {
				finished = true;
				// kill 直後の rmSync は Windows でファイルロックと競合し得るため、終了を待ってから削除
				child.kill();
				await new Promise((resolve) => (childExited ? resolve() : child.once('exit', resolve)));
				childExited = true;
				cleanup();
				console.log(`[desktop:smoke] smoke OK (${((Date.now() - started) / 1000).toFixed(1)}s)`);
				process.exit(0);
			}
			// 2xx だが nonce 不一致 = 別サービスに接続している。リトライしても直らないため即失敗
			fail(`nonce が一致しません（期待=${nonce}, 実際=${echoed ?? '(なし)'}）`);
		}
	} catch {
		// 起動前の接続拒否は想定内。次のポーリングまで待つ
	}
	await sleep(POLL_INTERVAL_MS);
}

fail(`タイムアウト: ${TIMEOUT_MS / 1000}秒以内に /api/health が ready になりませんでした`);
