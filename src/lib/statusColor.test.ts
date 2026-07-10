import { describe, expect, it } from 'vitest';
import { STATUS_PALETTE, statusColor } from './statusColor';

describe('statusColor', () => {
	it('ID=1 からパレット先頭の色を順に割り当てる', () => {
		expect(statusColor(1)).toBe(STATUS_PALETTE[0]);
		expect(statusColor(2)).toBe(STATUS_PALETTE[1]);
		expect(statusColor(STATUS_PALETTE.length)).toBe(STATUS_PALETTE[STATUS_PALETTE.length - 1]);
	});

	it('パレット数を超えたIDは循環する', () => {
		expect(statusColor(STATUS_PALETTE.length + 1)).toBe(STATUS_PALETTE[0]);
		expect(statusColor(STATUS_PALETTE.length * 3 + 2)).toBe(STATUS_PALETTE[1]);
	});

	it('同じIDには常に同じ色を返す', () => {
		expect(statusColor(5)).toBe(statusColor(5));
	});

	it('正の整数以外はフォールバックとして先頭色を返す', () => {
		expect(statusColor(0)).toBe(STATUS_PALETTE[0]);
		expect(statusColor(-3)).toBe(STATUS_PALETTE[0]);
		expect(statusColor(1.5)).toBe(STATUS_PALETTE[0]);
		expect(statusColor(NaN)).toBe(STATUS_PALETTE[0]);
	});
});
