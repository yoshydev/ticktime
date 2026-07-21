/**
 * health エンドポイントのレスポンスヘッダを組み立てる純関数。
 *
 * nonce は Tauri デスクトップシェルが起動時に「自分が spawn したサーバーか」を
 * 識別するためのエコー。GET で誰でも取得できるため、認可トークンではない。
 */
export function buildHealthHeaders(nonce: string | undefined): Record<string, string> {
	const headers: Record<string, string> = { 'cache-control': 'no-store' };
	// 非空文字列のときのみエコーする（undefined・空文字は省略）
	if (nonce) {
		headers['x-ticktime-nonce'] = nonce;
	}
	return headers;
}
