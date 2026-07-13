import type { Handle } from '@sveltejs/kit';
import { isTrustedFormSubmission } from '$lib/csrf';

/** CSRF検証メッセージ（use:enhance / 通常送信の双方で同一文言を返す）。 */
const CSRF_MESSAGE = 'クロスサイトからのフォーム送信は拒否されました';

/**
 * CSRF対策の handle フック。
 *
 * kit標準CSRFチェック（ORIGIN 環境変数との固定比較）は、npx配布版で
 * localhost / 127.0.0.1 / [::1] のどれでアクセスされても成立させる必要があるため
 * vite.config.ts の `csrf: { trustedOrigins: ['*'] }` で無効化し、
 * ここで「Origin ヘッダ ↔ Host ヘッダ一致」の検証に置き換えている。
 * devサーバーでも同様にこのフックが走る。
 */
export const handle: Handle = async ({ event, resolve }) => {
	const trusted = isTrustedFormSubmission({
		method: event.request.method,
		contentType: event.request.headers.get('content-type'),
		originHeader: event.request.headers.get('origin'),
		hostHeader: event.request.headers.get('host')
	});

	if (!trusted) {
		if (event.request.headers.get('accept') === 'application/json') {
			// use:enhance からの送信: ActionResult 形式で返し、クライアント側で
			// result.type === 'error' として拾えるようにする
			return new Response(
				JSON.stringify({ type: 'error', error: { message: CSRF_MESSAGE } }),
				{ status: 403, headers: { 'content-type': 'application/json' } }
			);
		}
		return new Response(CSRF_MESSAGE, {
			status: 403,
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		});
	}

	return resolve(event);
};
