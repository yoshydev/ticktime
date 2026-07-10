import { describe, it, expect } from 'vitest';
import { formatHMS, formatHM, parseDuration, roundToHours } from './duration';

describe('formatHMS', () => {
	it('0 秒は 0:00:00', () => {
		expect(formatHMS(0)).toBe('0:00:00');
	});
	it('分・秒をゼロ埋めする', () => {
		expect(formatHMS(9 * 60 + 5)).toBe('0:09:05');
	});
	it('時は桁数上限なし', () => {
		expect(formatHMS(2 * 3600 + 49 * 60 + 33)).toBe('2:49:33');
		expect(formatHMS(100 * 3600)).toBe('100:00:00');
	});
	it('端数秒は切り捨て', () => {
		expect(formatHMS(61.9)).toBe('0:01:01');
	});
});

describe('formatHM', () => {
	it('秒を切り捨てて h:mm', () => {
		expect(formatHM(2 * 3600 + 49 * 60 + 59)).toBe('2:49');
		expect(formatHM(0)).toBe('0:00');
	});
});

describe('parseDuration', () => {
	it('h:mm を秒に変換', () => {
		expect(parseDuration('1:30')).toBe(1 * 3600 + 30 * 60);
		expect(parseDuration('0:00')).toBe(0);
	});
	it('h:mm:ss を秒に変換', () => {
		expect(parseDuration('2:49:33')).toBe(2 * 3600 + 49 * 60 + 33);
	});
	it('ゼロ埋め・前後空白を許容', () => {
		expect(parseDuration(' 01:05 ')).toBe(65 * 60);
	});
	it('不正な形式は null', () => {
		expect(parseDuration('')).toBeNull();
		expect(parseDuration('90')).toBeNull();
		expect(parseDuration('1:60')).toBeNull();
		expect(parseDuration('1:00:60')).toBeNull();
		expect(parseDuration('a:bb')).toBeNull();
		expect(parseDuration('1:2:3:4')).toBeNull();
	});
});

describe('roundToHours', () => {
	it('1:29 は 1 時間に切り捨て相当（四捨五入）', () => {
		expect(roundToHours(1 * 3600 + 29 * 60)).toBe(1);
	});
	it('1:30 は 2 時間に切り上げ（四捨五入）', () => {
		expect(roundToHours(1 * 3600 + 30 * 60)).toBe(2);
	});
	it('2:49:33 は 3 時間', () => {
		expect(roundToHours(2 * 3600 + 49 * 60 + 33)).toBe(3);
	});
	it('0 秒は 0', () => {
		expect(roundToHours(0)).toBe(0);
	});
});
