/** CSRF対策: フォーム送信リクエストの Origin ↔ Host 一致検証（純関数）。
 *
 * kit標準チェックは ORIGIN 環境変数（単一値）との固定比較のため、
 * localhost / 127.0.0.1 / [::1] のどれでアクセスされるか実行時まで分からない
 * ローカル配信では使えない。代わりに「Origin ヘッダの host 部が Host ヘッダと
 * 一致するか」で同一オリジン送信かを判定する。
 */

/** 検証対象のHTTPメソッド（副作用を持つもの）。 */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** ブラウザがクロスサイトの単純リクエストとして送信できるフォーム系 Content-Type。 */
const FORM_CONTENT_TYPES = new Set([
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain'
]);

/** ループバックとみなすホスト名か（localhost / 127.0.0.0/8 / [::1]）。 */
function isLoopbackHostname(hostname: string): boolean {
	if (hostname === 'localhost' || hostname === '[::1]') return true;
	return /^127(\.\d{1,3}){3}$/.test(hostname);
}

/**
 * フォーム送信として信頼できるリクエストか判定する。
 * - 検証対象外（GET等・非フォームContent-Type）は true
 * - 検証対象は Origin の host:port が Host ヘッダと完全一致し、かつホスト名が
 *   ループバックの場合のみ true。一致だけだと、攻撃者ドメインをループバックに
 *   解決させる DNSリバインディングで Origin と Host が揃ってしまうため、
 *   ローカル起動専用の前提どおりループバック以外は拒否する
 */
export function isTrustedFormSubmission(params: {
	method: string;
	contentType: string | null;
	originHeader: string | null;
	hostHeader: string | null;
}): boolean {
	const { method, contentType, originHeader, hostHeader } = params;

	// 副作用のないメソッドは検証対象外
	if (!MUTATING_METHODS.has(method.toUpperCase())) return true;

	// フォーム系Content-Type以外（application/json等）はブラウザの単純リクエストに
	// なり得ないため検証対象外（`; boundary=...` 等のパラメータは除いて比較）
	const baseType = (contentType ?? '').split(';')[0].trim().toLowerCase();
	if (!FORM_CONTENT_TYPES.has(baseType)) return true;

	// Origin が無い・不透明（'null'）な送信は拒否
	if (!originHeader || originHeader.trim() === '' || originHeader.trim() === 'null') return false;

	let originUrl: URL;
	try {
		originUrl = new URL(originHeader);
	} catch {
		return false;
	}

	// ローカル配信はhttpのみ（httpsで立てる運用は想定外）
	if (originUrl.protocol !== 'http:') return false;

	if (!hostHeader || hostHeader.trim() === '') return false;

	// URL.host は host:port 形式（デフォルトポートは省略形）。Host ヘッダと表記が一致する
	// （IPv6 の [::1]:8425 も両者同表記のため特別扱い不要）
	if (originUrl.host.trim().toLowerCase() !== hostHeader.trim().toLowerCase()) return false;

	// 一致していてもループバック以外のホスト名は拒否（DNSリバインディング対策）
	return isLoopbackHostname(originUrl.hostname.toLowerCase());
}
