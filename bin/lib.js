// bin/ticktime.js から使う純関数群。副作用なし（env/platform/home はすべて引数で受ける）。
import { win32, posix } from 'node:path';

/** デフォルトポート（キーパッドで T=8 I=4 C=2 K=5 → TICK） */
export const DEFAULT_PORT = 8425;

/**
 * DBパスを解決する。優先順位: --db フラグ > TICKTIME_DB 環境変数 > プラットフォーム別デフォルト。
 * 返り値は相対パスの可能性があるため、呼び出し側で path.resolve() して使うこと。
 *
 * @param {object} params
 * @param {string | undefined} params.dbFlag --db フラグの値
 * @param {Record<string, string | undefined>} params.env 環境変数（process.env 相当）
 * @param {string} params.platform process.platform 相当（'win32' | 'darwin' | 'linux' など）
 * @param {string} params.home ホームディレクトリ（os.homedir() 相当）
 * @returns {string} DBファイルパス
 */
export function resolveDbPath({ dbFlag, env, platform, home }) {
	if (dbFlag) return dbFlag;
	if (env.TICKTIME_DB) return env.TICKTIME_DB;

	// platform 引数に対応する区切り文字で結合する（実行OSの path モジュールに依存させない）
	const { join } = platform === 'win32' ? win32 : posix;
	if (platform === 'win32') {
		// %LOCALAPPDATA% が無ければ %USERPROFILE% 配下の標準位置にフォールバック
		const base = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
		return join(base, 'ticktime', 'ticktime.db');
	}
	if (platform === 'darwin') {
		return join(home, 'Library', 'Application Support', 'ticktime', 'ticktime.db');
	}
	// linux ほか: XDG Base Directory 準拠
	const base = env.XDG_DATA_HOME || join(home, '.local', 'share');
	return join(base, 'ticktime', 'ticktime.db');
}

/**
 * リッスンポートを解決する。優先順位: --port フラグ > PORT 環境変数 > デフォルト 8425。
 * 1〜65535 の整数以外はエラーを投げる。
 *
 * @param {object} params
 * @param {string | undefined} params.portFlag --port フラグの値
 * @param {Record<string, string | undefined>} params.env 環境変数（process.env 相当）
 * @returns {number} ポート番号
 */
export function resolvePort({ portFlag, env }) {
	const raw = portFlag ?? env.PORT;
	if (raw === undefined || raw === '') return DEFAULT_PORT;
	// 10進数字のみ許可（Number() は '1e3' や '0x50' も通してしまうため）
	if (!/^\d+$/.test(raw)) {
		throw new Error(`invalid port: ${raw} (expected an integer between 1 and 65535)`);
	}
	const port = Number(raw);
	if (port < 1 || port > 65535) {
		throw new Error(`invalid port: ${raw} (expected an integer between 1 and 65535)`);
	}
	return port;
}

/**
 * サーバー起動用の env 値と表示URLを解決する。
 * - host: 既存 HOST を尊重。無ければ 127.0.0.1（外部非公開デフォルト）
 * - origin: 既存 ORIGIN を尊重。無ければ http://localhost:<port>
 * - displayUrl: 必ず origin から導出する（表示URL・--open・POST時のorigin検証を常に一致させるため）
 *
 * @param {object} params
 * @param {number} params.port リッスンポート
 * @param {Record<string, string | undefined>} params.env 環境変数（process.env 相当）
 * @returns {{ host: string, origin: string, displayUrl: string }}
 */
export function resolveServeEnv({ port, env }) {
	const host = env.HOST || '127.0.0.1';
	const origin = env.ORIGIN || `http://localhost:${port}`;
	return { host, origin, displayUrl: origin };
}
