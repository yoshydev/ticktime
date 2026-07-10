import { describe, it, expect } from 'vitest';
import { toWorkDate } from './workdate';

/** JST の日時を epoch ms に変換するヘルパー（UTC-9 で組み立て）。 */
function jst(y: number, mo: number, d: number, h: number, mi = 0, s = 0): number {
	return Date.UTC(y, mo - 1, d, h - 9, mi, s);
}

describe('toWorkDate', () => {
	it('境界(5時)より前の JST 4:59 は前日に帰属', () => {
		expect(toWorkDate(jst(2026, 7, 10, 4, 59), 5)).toBe('2026-07-09');
	});
	it('境界(5時)ちょうどの JST 5:00 は当日に帰属', () => {
		expect(toWorkDate(jst(2026, 7, 10, 5, 0), 5)).toBe('2026-07-10');
	});
	it('日中の JST 14:00 は当日', () => {
		expect(toWorkDate(jst(2026, 7, 10, 14, 0), 5)).toBe('2026-07-10');
	});
	it('深夜 JST 1:00 は前日（境界5時）', () => {
		expect(toWorkDate(jst(2026, 7, 10, 1, 0), 5)).toBe('2026-07-09');
	});
	it('月をまたぐ深夜も正しく前日になる', () => {
		expect(toWorkDate(jst(2026, 8, 1, 3, 0), 5)).toBe('2026-07-31');
	});
	it('境界0時なら JST の暦日と一致', () => {
		expect(toWorkDate(jst(2026, 7, 10, 0, 30), 0)).toBe('2026-07-10');
		expect(toWorkDate(jst(2026, 7, 10, 23, 30), 0)).toBe('2026-07-10');
	});
	it('サーバー TZ に依存しない（UTC 演算のみ）', () => {
		// 同一 epoch は TZ に関係なく同じ結果を返す
		const t = jst(2026, 7, 10, 12, 0);
		expect(toWorkDate(t, 5)).toBe('2026-07-10');
	});
});
