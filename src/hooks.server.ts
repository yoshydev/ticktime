import type { Handle } from '@sveltejs/kit';
import { isTrustedFormSubmission } from '$lib/csrf';
import { evaluateAuth } from '$lib/server/authGuard';

/** CSRF検証メッセージ（use:enhance / 通常送信の双方で同一文言を返す）。 */
const CSRF_MESSAGE = 'クロスサイトからのフォーム送信は拒否されました';

/** 認可失敗メッセージ（デスクトップ版で cookie を持たないアクセスへ返す）。 */
const AUTH_MESSAGE = '認可トークンがありません。ticktime デスクトップアプリを再起動してください';

/** accept ヘッダに応じて JSON（ActionResult形式）/ text/plain のエラー応答を組み立てる。 */
function errorResponse(status: number, message: string, acceptHeader: string | null): Response {
	if (acceptHeader !== null && acceptHeader.includes('application/json')) {
		// use:enhance からの送信: ActionResult 形式で返し、クライアント側で
		// result.type === 'error' として拾えるようにする
		return new Response(JSON.stringify({ type: 'error', error: { message } }), {
			status,
			headers: { 'content-type': 'application/json' }
		});
	}
	return new Response(message, {
		status,
		headers: { 'content-type': 'text/plain; charset=utf-8' }
	});
}

/**
 * 認可（デスクトップ版のみ）→ CSRF検証 の順で適用する handle フック。
 *
 * 認可層: TICKTIME_AUTH_TOKEN が設定されているとき（Tauri デスクトップシェル起動時）、
 * GET /auth?token=... のブートストラップで session cookie を配り、以降は cookie 照合で
 * 通す。/api/health（GET/HEAD）は Rust 起動プローブのため認可なしで通す。
 *
 * CSRF層: kit標準CSRFチェック（ORIGIN 環境変数との固定比較）は、npx配布版で
 * localhost / 127.0.0.1 / [::1] のどれでアクセスされても成立させる必要があるため
 * vite.config.ts の `csrf: { trustedOrigins: ['*'] }` で無効化し、
 * ここで「Origin ヘッダ ↔ Host ヘッダ一致」の検証に置き換えている。
 * devサーバーでも同様にこのフックが走る。
 */
export const handle: Handle = async ({ event, resolve }) => {
	// リクエスト時に読む（モジュールトップで読むと起動順に依存するため）
	const configuredToken = process.env.TICKTIME_AUTH_TOKEN;

	const decision = evaluateAuth({
		configuredToken,
		method: event.request.method,
		pathname: event.url.pathname,
		queryTokens: event.url.searchParams.getAll('token'),
		cookieHeader: event.request.headers.get('cookie')
	});

	if (decision.kind === 'grant') {
		// ブートストラップ成功: cookie を配ってトップへリダイレクト。
		// token 入り URL がキャッシュ・Referer に残らないようヘッダで抑止する
		return new Response(null, {
			status: 303,
			headers: {
				location: '/',
				'set-cookie': decision.setCookieHeader,
				'cache-control': 'no-store',
				'referrer-policy': 'no-referrer'
			}
		});
	}

	if (decision.kind === 'deny') {
		return errorResponse(401, AUTH_MESSAGE, event.request.headers.get('accept'));
	}

	const trusted = isTrustedFormSubmission({
		method: event.request.method,
		contentType: event.request.headers.get('content-type'),
		originHeader: event.request.headers.get('origin'),
		hostHeader: event.request.headers.get('host')
	});

	if (!trusted) {
		return errorResponse(403, CSRF_MESSAGE, event.request.headers.get('accept'));
	}

	return resolve(event);
};
