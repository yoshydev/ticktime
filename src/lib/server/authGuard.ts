/** デスクトップ版向け localhost 認可トークンの判定ロジック（純関数）。
 *
 * Tauri デスクトップシェルが起動時に生成したトークンを環境変数
 * TICKTIME_AUTH_TOKEN でサーバーへ渡し、ブラウザ側は
 * GET /auth?token=... のブートストラップで session cookie を受け取る。
 * 以降のリクエストは cookie の照合のみで通す。
 * env・リクエスト情報はすべて引数で受け、判定はここに閉じる。
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/** 認可トークンを保持する cookie 名。 */
export const AUTH_COOKIE_NAME = 'ticktime_auth';

/** トークンを cookie に変換するブートストラップ用パス。 */
export const BOOTSTRAP_PATH = '/auth';

/** DoS耐性: これを超える長さの入力は照合（ハッシュ計算）せずに deny する。 */
const MAX_TOKEN_LENGTH = 256;

/**
 * 文字列をタイミング攻撃耐性つきで比較する。
 * 両辺を sha256 で固定長化してから timingSafeEqual に渡すため、
 * 長さが違っても例外にならず、比較時間は入力内容に依存しない。
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
	const hashA = createHash('sha256').update(a).digest();
	const hashB = createHash('sha256').update(b).digest();
	return timingSafeEqual(hashA, hashB);
}

/**
 * Cookie ヘッダから名前指定で値を抽出する。
 * '; ' 区切り・前後空白 trim・最初の一致を返す。
 * トークンは hex のみなのでデコードはしない。
 */
export function getCookieValue(cookieHeader: string | null, name: string): string | undefined {
	if (cookieHeader === null) return undefined;
	for (const part of cookieHeader.split(';')) {
		const eq = part.indexOf('=');
		if (eq === -1) continue;
		if (part.slice(0, eq).trim() === name) {
			return part.slice(eq + 1).trim();
		}
	}
	return undefined;
}

/**
 * 認可 cookie の Set-Cookie ヘッダ値を組み立てる。
 * http://localhost 配信のため Secure なし、Max-Age なし（session cookie）、Domain なし。
 */
export function buildAuthCookieHeader(token: string): string {
	return `${AUTH_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict`;
}

export type AuthDecision =
	| { kind: 'pass' }
	| { kind: 'grant'; setCookieHeader: string }
	| { kind: 'deny' };

/**
 * リクエストの認可判定。判定順そのものが仕様:
 * 1. configuredToken 未設定（undefined/空文字）→ pass（npx版・vite dev では認可層無効）
 * 2. /auth はブートストラップ分岐としてここで確定（既存 cookie では通さない）:
 *    GET かつ token クエリがちょうど1つ・非空・長さ上限内・一致 → grant、それ以外は deny
 * 3. GET/HEAD /api/health（完全一致のみ）→ pass（Rust起動プローブと smoke 契約の維持）
 * 4. cookie の値が非空・長さ上限内・一致 → pass
 * 5. それ以外 → deny
 */
export function evaluateAuth(params: {
	configuredToken: string | undefined;
	method: string;
	pathname: string;
	queryTokens: string[];
	cookieHeader: string | null;
}): AuthDecision {
	const { configuredToken, method, pathname, queryTokens, cookieHeader } = params;

	// 1. トークン未設定なら認可層は無効（npx配布版・vite dev）
	if (configuredToken === undefined || configuredToken === '') {
		return { kind: 'pass' };
	}

	// 2. ブートストラップパスはここで確定する（既存 cookie による pass に流さない）。
	//    正 cookie を持っていても token 不正の /auth は deny になる
	if (pathname === BOOTSTRAP_PATH) {
		if (
			method === 'GET' &&
			queryTokens.length === 1 &&
			queryTokens[0] !== '' &&
			queryTokens[0].length <= MAX_TOKEN_LENGTH &&
			timingSafeEqualStrings(queryTokens[0], configuredToken)
		) {
			return { kind: 'grant', setCookieHeader: buildAuthCookieHeader(configuredToken) };
		}
		return { kind: 'deny' };
	}

	// 3. health は認可なしで通す（完全一致のみ。/api/health/xxx は対象外）
	if (pathname === '/api/health' && (method === 'GET' || method === 'HEAD')) {
		return { kind: 'pass' };
	}

	// 4. cookie 照合
	const cookieToken = getCookieValue(cookieHeader, AUTH_COOKIE_NAME);
	if (
		cookieToken !== undefined &&
		cookieToken !== '' &&
		cookieToken.length <= MAX_TOKEN_LENGTH &&
		timingSafeEqualStrings(cookieToken, configuredToken)
	) {
		return { kind: 'pass' };
	}

	// 5. それ以外はすべて deny
	return { kind: 'deny' };
}
