import { describe, it, expect } from 'vitest';
import { renderTemplate, findInvalidPlaceholders } from './template';

describe('renderTemplate', () => {
	it('基本の変数置換ができる', () => {
		expect(renderTemplate('feature/{ticket_key}', { ticket_key: 'ABC-123' })).toBe(
			'feature/ABC-123'
		);
	});

	it('同一変数が複数回出現しても全て置換する', () => {
		expect(renderTemplate('{title}/{title}', { title: 'x' })).toBe('x/x');
	});

	it('vars に無い変数はそのまま残す', () => {
		expect(renderTemplate('{ticket_key}-{unknown}', { ticket_key: 'ABC-123' })).toBe(
			'ABC-123-{unknown}'
		);
	});

	it('値に {title} が含まれても再置換されない（1パス置換）', () => {
		expect(renderTemplate('[{ticket_key}]{title}', { ticket_key: '{title}', title: 'x' })).toBe(
			'[{title}]x'
		);
	});

	it('encode 指定時は値に encodeURIComponent が適用される', () => {
		expect(
			renderTemplate('https://example.com/?q={title}', { title: '請求書 修正' }, encodeURIComponent)
		).toBe('https://example.com/?q=%E8%AB%8B%E6%B1%82%E6%9B%B8%20%E4%BF%AE%E6%AD%A3');
	});

	it('空文字の値でも置換する', () => {
		expect(renderTemplate('a{title}b', { title: '' })).toBe('ab');
	});

	it('{} や { } や大文字の変数名はプレースホルダとして扱わない', () => {
		expect(renderTemplate('{}/{ }/{Title}', { title: 'x' })).toBe('{}/{ }/{Title}');
	});
});

describe('findInvalidPlaceholders', () => {
	const known = ['ticket_key', 'title'] as const;

	it('known に無い変数を検出する', () => {
		expect(findInvalidPlaceholders('{ticket_key}-{unknown}', known)).toEqual(['{unknown}']);
	});

	it('{ticketKey} のような正規形にマッチしないトークンも検出する', () => {
		expect(findInvalidPlaceholders('{ticketKey}/{date-year}', known)).toEqual([
			'{ticketKey}',
			'{date-year}'
		]);
	});

	it('同じ不正トークンは重複除去して返す', () => {
		expect(findInvalidPlaceholders('{unknown}{unknown}{title}', known)).toEqual(['{unknown}']);
	});

	it('正常なテンプレートでは空配列を返す', () => {
		expect(findInvalidPlaceholders('[WIP][{ticket_key}]{title}', known)).toEqual([]);
	});
});
