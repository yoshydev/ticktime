import { describe, it, expect } from 'vitest';
import { buildHealthHeaders } from './health';

describe('buildHealthHeaders', () => {
	it('nonce ありなら cache-control と x-ticktime-nonce を返す', () => {
		expect(buildHealthHeaders('abc123')).toEqual({
			'cache-control': 'no-store',
			'x-ticktime-nonce': 'abc123'
		});
	});

	it('nonce が undefined なら cache-control のみ返す', () => {
		expect(buildHealthHeaders(undefined)).toEqual({ 'cache-control': 'no-store' });
	});

	it('nonce が空文字なら x-ticktime-nonce を省略する', () => {
		expect(buildHealthHeaders('')).toEqual({ 'cache-control': 'no-store' });
	});
});
