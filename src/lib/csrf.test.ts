import { describe, it, expect } from 'vitest';
import { isTrustedFormSubmission } from './csrf';

/** フォームPOSTの基本形（個別ケースで上書きする）。 */
const base = {
	method: 'POST',
	contentType: 'application/x-www-form-urlencoded',
	originHeader: 'http://localhost:8425',
	hostHeader: 'localhost:8425'
};

describe('isTrustedFormSubmission', () => {
	it('GET は常に許可（検証対象外）', () => {
		expect(
			isTrustedFormSubmission({ ...base, method: 'GET', originHeader: null, hostHeader: null })
		).toBe(true);
	});

	it('非フォーム Content-Type（application/json）の POST は許可（検証対象外）', () => {
		expect(
			isTrustedFormSubmission({
				...base,
				contentType: 'application/json',
				originHeader: 'http://evil.example'
			})
		).toBe(true);
	});

	it('フォームPOSTで Origin と Host が一致すれば許可', () => {
		expect(isTrustedFormSubmission(base)).toBe(true);
		expect(
			isTrustedFormSubmission({
				...base,
				originHeader: 'http://127.0.0.1:8425',
				hostHeader: '127.0.0.1:8425'
			})
		).toBe(true);
		expect(
			isTrustedFormSubmission({
				...base,
				originHeader: 'http://[::1]:8425',
				hostHeader: '[::1]:8425'
			})
		).toBe(true);
	});

	it('大文字小文字差は許容する', () => {
		expect(
			isTrustedFormSubmission({
				...base,
				originHeader: 'http://LocalHost:8425',
				hostHeader: 'LOCALHOST:8425'
			})
		).toBe(true);
	});

	it('multipart/form-data（boundary付き）・text/plain も検証対象として一致すれば許可', () => {
		expect(
			isTrustedFormSubmission({
				...base,
				contentType: 'multipart/form-data; boundary=----WebKitFormBoundaryX'
			})
		).toBe(true);
		expect(isTrustedFormSubmission({ ...base, contentType: 'Text/Plain' })).toBe(true);
	});

	it('Origin 欠落・空・"null"・パース不能は拒否', () => {
		expect(isTrustedFormSubmission({ ...base, originHeader: null })).toBe(false);
		expect(isTrustedFormSubmission({ ...base, originHeader: '' })).toBe(false);
		expect(isTrustedFormSubmission({ ...base, originHeader: 'null' })).toBe(false);
		expect(isTrustedFormSubmission({ ...base, originHeader: 'not a url' })).toBe(false);
	});

	it('https スキームの Origin は拒否（ローカル配信はhttpのみ）', () => {
		expect(
			isTrustedFormSubmission({ ...base, originHeader: 'https://localhost:8425' })
		).toBe(false);
	});

	it('host 不一致は拒否（別ホスト・ポート違い・localhost/127.0.0.1 のクロス）', () => {
		expect(
			isTrustedFormSubmission({ ...base, originHeader: 'http://evil.example' })
		).toBe(false);
		expect(
			isTrustedFormSubmission({ ...base, originHeader: 'http://localhost:9999' })
		).toBe(false);
		expect(
			isTrustedFormSubmission({
				...base,
				originHeader: 'http://localhost:8425',
				hostHeader: '127.0.0.1:8425'
			})
		).toBe(false);
		expect(
			isTrustedFormSubmission({
				...base,
				originHeader: 'http://127.0.0.1:8425',
				hostHeader: 'localhost:8425'
			})
		).toBe(false);
	});

	it('ループバック以外のホスト名は Origin と Host が一致していても拒否（DNSリバインディング対策）', () => {
		expect(
			isTrustedFormSubmission({
				...base,
				originHeader: 'http://evil.example:8425',
				hostHeader: 'evil.example:8425'
			})
		).toBe(false);
		expect(
			isTrustedFormSubmission({
				...base,
				originHeader: 'http://foo.127.0.0.1.nip.io:8425',
				hostHeader: 'foo.127.0.0.1.nip.io:8425'
			})
		).toBe(false);
	});

	it('127.0.0.0/8 のループバック帯は許可', () => {
		expect(
			isTrustedFormSubmission({
				...base,
				originHeader: 'http://127.0.0.2:8425',
				hostHeader: '127.0.0.2:8425'
			})
		).toBe(true);
	});

	it('Host 欠落・空は拒否', () => {
		expect(isTrustedFormSubmission({ ...base, hostHeader: null })).toBe(false);
		expect(isTrustedFormSubmission({ ...base, hostHeader: '' })).toBe(false);
	});

	it('PUT / PATCH / DELETE も検証対象（Origin 欠落なら拒否・一致なら許可）', () => {
		for (const method of ['PUT', 'PATCH', 'DELETE']) {
			expect(isTrustedFormSubmission({ ...base, method, originHeader: null })).toBe(false);
			expect(isTrustedFormSubmission({ ...base, method })).toBe(true);
		}
	});
});
