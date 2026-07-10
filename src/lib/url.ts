/**
 * value を URL としてパースし、protocol が http: / https: のときのみ true を返す。
 * パース不能な文字列は false。空文字は false になるため、空を許容するかは呼び出し側で扱う。
 */
export function isSafeHttpUrl(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	return url.protocol === 'http:' || url.protocol === 'https:';
}
