import { describe, it, expect } from 'vitest';
import { isSafeHttpUrl } from './url';

describe('isSafeHttpUrl', () => {
	it('http / https は true', () => {
		expect(isSafeHttpUrl('http://example.com')).toBe(true);
		expect(isSafeHttpUrl('https://example.atlassian.net/browse/TICKET-123')).toBe(true);
	});
	it('http/https 以外のスキームは false', () => {
		expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
		expect(isSafeHttpUrl('data:text/html,x')).toBe(false);
		expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false);
		expect(isSafeHttpUrl('ftp://example.com')).toBe(false);
	});
	it('パース不能な文字列・空文字は false', () => {
		expect(isSafeHttpUrl('')).toBe(false);
		expect(isSafeHttpUrl('not a url')).toBe(false);
		expect(isSafeHttpUrl('/browse/TICKET-123')).toBe(false);
	});
});
