// サイドカーバイナリの単体スモークテスト（CI用・3OS共通）
// 使い方: node desktop/scripts/smoke-sidecar.mjs
//
// desktop/build-server.mjs で生成したサイドカーを一時DB + ランダムポートで起動し、
// /api/health が 2xx かつ起動nonce（x-ticktime-nonce ヘッダ）をエコーするまで
// ポーリングする。ready 後は認可トークン（TICKTIME_AUTH_TOKEN）の契約
// （未認可401 / /auth ブートストラップ / cookie通過）も検証する。
// Tauriシェル（desktop/src-tauri/src/main.rs）と同じ起動契約を GUIなしで検証するのが目的。
// 注意: 失敗メッセージにトークン値を含めないこと（CIログへの漏えい防止）。
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
// 認可トークン（Tauriシェルの Uuid v4 ×2連結・64文字hex と同形式）
const authToken = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
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
		TICKTIME_STARTUP_NONCE: nonce,
		TICKTIME_AUTH_TOKEN: authToken
	},
	stdio: ['ignore', 'pipe', 'pipe']
});

// トークンのCIログ漏えい防止: 実トークンの完全一致と token=<英数字> をマスクする。
// 現状サーバーはリクエストURLをログしないが、将来ログが増えた場合の防衛線
// （desktop/src-tauri/src/main.rs の redaction と同趣旨）
const redact = (line) => line.replaceAll(authToken, '***').replace(/token=[A-Za-z0-9]+/g, 'token=***');

// サイドカーの出力を [sidecar] プレフィックスで中継。
// チャンク境界での行分割によるマスク漏れを防ぐため、行単位にバッファしてから出力する
const relay = (stream, write) => {
	stream.setEncoding('utf8');
	let buf = '';
	stream.on('data', (chunk) => {
		buf += chunk;
		const lines = buf.split('\n');
		buf = lines.pop() ?? '';
		for (const line of lines) {
			if (line.trim() !== '') write(`[sidecar] ${redact(line)}`);
		}
	});
	stream.on('end', () => {
		if (buf.trim() !== '') write(`[sidecar] ${redact(buf)}`);
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

// 認可トークンの契約検証（health ready 後に実行）。
// リダイレクトは追わず（redirect: 'manual'）、各fetchに個別タイムアウトを付ける。
async function verifyAuth() {
	const base = `http://127.0.0.1:${port}`;
	const opts = () => ({ redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

	// 1. 未認可の GET / は 401
	let res = await fetch(`${base}/`, opts());
	if (res.status !== 401) await fail(`GET /（cookieなし）が 401 ではありません: ${res.status}`);

	// 2. 保護対象API（Jiraプロキシ）も 401
	res = await fetch(`${base}/api/jira/TEST-1`, opts());
	if (res.status !== 401) await fail(`GET /api/jira/TEST-1（cookieなし）が 401 ではありません: ${res.status}`);

	// 3. POST /auth は正トークンでも 401（ブートストラップはGET限定）
	res = await fetch(`${base}/auth?token=${authToken}`, { ...opts(), method: 'POST' });
	if (res.status !== 401) await fail(`POST /auth（正トークン）が 401 ではありません: ${res.status}`);

	// 4. 不正トークンの /auth は 401 かつ Set-Cookie なし
	res = await fetch(`${base}/auth?token=${'0'.repeat(64)}`, opts());
	if (res.status !== 401) await fail(`GET /auth（不正トークン）が 401 ではありません: ${res.status}`);
	if (res.headers.get('set-cookie') !== null) {
		await fail('GET /auth（不正トークン）で Set-Cookie が返されました');
	}

	// 5. 正トークンの /auth は 303 + Location: / + HttpOnly cookie + referrer-policy
	res = await fetch(`${base}/auth?token=${authToken}`, opts());
	if (res.status !== 303) await fail(`GET /auth（正トークン）が 303 ではありません: ${res.status}`);
	if (res.headers.get('location') !== '/') {
		await fail(`GET /auth の Location が / ではありません: ${res.headers.get('location')}`);
	}
	if (res.headers.get('referrer-policy') !== 'no-referrer') {
		await fail('GET /auth の referrer-policy が no-referrer ではありません');
	}
	const setCookie = res.headers.get('set-cookie') ?? '';
	if (!setCookie.startsWith('ticktime_auth=') || !/httponly/i.test(setCookie)) {
		await fail('GET /auth の Set-Cookie が ticktime_auth + HttpOnly ではありません');
	}
	// session cookie 契約: SameSite=Strict / Path=/ を持ち、有効期限系属性を持たないこと
	if (!/samesite=strict/i.test(setCookie) || !/path=\//i.test(setCookie)) {
		await fail('GET /auth の Set-Cookie に SameSite=Strict / Path=/ がありません');
	}
	if (/max-age|expires/i.test(setCookie)) {
		await fail('GET /auth の Set-Cookie が session cookie ではありません（Max-Age/Expires あり）');
	}
	const cookiePair = setCookie.split(';')[0];

	// 6. cookie 付きの GET / は 200
	res = await fetch(`${base}/`, { ...opts(), headers: { cookie: cookiePair } });
	if (res.status !== 200) await fail(`GET /（cookie付き）が 200 ではありません: ${res.status}`);

	// 7. /api/health は認可導入後も無認可で 200 + nonce エコー（既存契約の非破壊確認）
	res = await fetch(`${base}/api/health`, opts());
	if (!res.ok || res.headers.get('x-ticktime-nonce') !== nonce) {
		await fail(`GET /api/health（cookieなし）の契約が壊れています: ${res.status}`);
	}
	// HEAD も除外対象（Rustプローブは GET だが、除外仕様 GET/HEAD の契約を固定）
	res = await fetch(`${base}/api/health`, { ...opts(), method: 'HEAD' });
	if (!res.ok) await fail(`HEAD /api/health（cookieなし）が 2xx ではありません: ${res.status}`);
}

// /api/health を 2xx + nonce一致までポーリング
let ready = false;
while (Date.now() - started < TIMEOUT_MS) {
	try {
		// fetch 単体にもタイムアウトを付ける（応答を返さない相手だと全体タイムアウトに到達できないため）
		const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
		if (res.ok) {
			const echoed = res.headers.get('x-ticktime-nonce');
			if (echoed === nonce) {
				ready = true;
				break;
			}
			// 2xx だが nonce 不一致 = 別サービスに接続している。リトライしても直らないため即失敗
			await fail(`nonce が一致しません（期待=${nonce}, 実際=${echoed ?? '(なし)'}）`);
		}
	} catch {
		// 起動前の接続拒否・タイムアウトは想定内。次のポーリングまで待つ
	}
	await sleep(POLL_INTERVAL_MS);
}

if (!ready) {
	await fail(`タイムアウト: ${TIMEOUT_MS / 1000}秒以内に /api/health が ready になりませんでした`);
}

// ready 後に認可トークンの契約を検証（fetch例外もポーリングloopに握り潰させない）。
// 例外メッセージにトークン値は含まれない（URL・ヘッダを埋め込んでいないため）
try {
	await verifyAuth();
} catch (e) {
	await fail(`認可検証中に例外: ${e instanceof Error ? e.message : e}`);
}

finished = true;
await cleanup();
console.log(`[desktop:smoke] smoke OK (${((Date.now() - started) / 1000).toFixed(1)}s)`);
process.exit(0);
