/**
 * コピー用テンプレート（ブランチ名・PRタイトルなどのユーザー定義テンプレート）の型とパーサ。
 * settings の `copy_templates` キーに JSON 配列として保存される。純関数のみ。
 */

/** コピー用テンプレート1件。 */
export interface CopyTemplate {
	/** ボタンに表示するラベル。 */
	label: string;
	/** `{ticket_key}` `{title}` を使えるテンプレート文字列。 */
	template: string;
}

/** コピー用テンプレートで使用できる変数名。 */
export const COPY_TEMPLATE_VARS = ['ticket_key', 'title'] as const;

/** 要素が CopyTemplate として妥当か判定する。 */
function isValidEntry(value: unknown): value is CopyTemplate {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	return typeof v.label === 'string' && typeof v.template === 'string';
}

/**
 * settings 由来の JSON 文字列を CopyTemplate 配列にパースする。
 * 不正JSON・非配列は空配列に、label/template が欠落・非文字列の要素は捨てて、常に配列を返す。
 */
export function parseCopyTemplates(raw: string): CopyTemplate[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	return parsed
		.filter(isValidEntry)
		.map((entry) => ({ label: entry.label, template: entry.template }));
}
