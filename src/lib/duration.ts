/**
 * 作業時間（秒）と表示文字列の相互変換ユーティリティ。純関数のみ。
 */

/** 秒を `h:mm:ss` 形式にフォーマットする（時は桁数上限なし、分・秒はゼロ埋め）。 */
export function formatHMS(totalSeconds: number): string {
	const s = Math.max(0, Math.floor(totalSeconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	return `${h}:${pad2(m)}:${pad2(sec)}`;
}

/** 秒を `h:mm` 形式にフォーマットする（秒は切り捨て）。 */
export function formatHM(totalSeconds: number): string {
	const s = Math.max(0, Math.floor(totalSeconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	return `${h}:${pad2(m)}`;
}

/**
 * `h:mm:ss` または `h:mm` 形式の文字列を秒数にパースする。
 * 前後空白は無視。不正な形式は null を返す。
 *
 * 受理例: "1:30", "01:30", "2:49:33", "0:00", "10:5"（分1桁でも許容）
 */
export function parseDuration(input: string): number | null {
	const trimmed = input.trim();
	if (trimmed === '') return null;

	const parts = trimmed.split(':');
	if (parts.length < 2 || parts.length > 3) return null;

	const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
	if (nums.some((n) => Number.isNaN(n))) return null;

	let h: number;
	let m: number;
	let s: number;
	if (nums.length === 2) {
		[h, m] = nums;
		s = 0;
	} else {
		[h, m, s] = nums;
	}

	if (m > 59 || s > 59) return null;
	return h * 3600 + m * 60 + s;
}

/** 秒を 1 時間単位で四捨五入した整数時間にする（フォーム報告用。例: 1:29→1, 1:30→2）。 */
export function roundToHours(seconds: number): number {
	return Math.round(seconds / 3600);
}

function pad2(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}
