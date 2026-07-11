/**
 * `{variable}` 形式のプレースホルダを持つテンプレート文字列のユーティリティ。純関数のみ。
 * 変数名は `[a-z_]+`（小文字スネークケース）を正規形とする。
 */

/**
 * テンプレート内の `{variable}` を vars の値で1パス置換する。
 * - vars に無い変数はそのまま残す（実行時は寛容に扱う）
 * - 置換は1パスなので、値に `{title}` 等が含まれても再置換されない
 * - encode 指定時は各値に適用する（URL埋め込み用に encodeURIComponent など）
 */
export function renderTemplate(
	template: string,
	vars: Record<string, string>,
	encode?: (value: string) => string
): string {
	return template.replace(/\{([a-z_]+)\}/g, (match, name: string) => {
		if (!Object.prototype.hasOwnProperty.call(vars, name)) return match;
		const value = vars[name];
		return encode ? encode(value) : value;
	});
}

/**
 * テンプレート内の不正なプレースホルダを検出する（保存時の typo 検出用）。
 * `/\{[^{}]*\}/g` で `{...}` らしきトークンを走査し、
 * 「`[a-z_]+` 形式かつ known に含まれる」もの以外を重複除去して返す。
 * `{ticketKey}` `{date-year}` のような正規形にマッチしないトークンも検出できる。
 */
export function findInvalidPlaceholders(template: string, known: readonly string[]): string[] {
	const invalid = new Set<string>();
	for (const match of template.matchAll(/\{[^{}]*\}/g)) {
		const token = match[0];
		const name = token.slice(1, -1);
		if (!/^[a-z_]+$/.test(name) || !known.includes(name)) {
			invalid.add(token);
		}
	}
	return [...invalid];
}
