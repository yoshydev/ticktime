import { describe, it, expect } from 'vitest';
import { parseCopyTemplates } from './copyTemplates';

describe('parseCopyTemplates', () => {
	it('正常なJSON配列をパースする', () => {
		const raw = JSON.stringify([
			{ label: 'ブランチ', template: 'feature/{ticket_key}' },
			{ label: 'PRタイトル', template: '[WIP][{ticket_key}]{title}' }
		]);
		expect(parseCopyTemplates(raw)).toEqual([
			{ label: 'ブランチ', template: 'feature/{ticket_key}' },
			{ label: 'PRタイトル', template: '[WIP][{ticket_key}]{title}' }
		]);
	});

	it('不正なJSONは空配列を返す', () => {
		expect(parseCopyTemplates('not json')).toEqual([]);
		expect(parseCopyTemplates('')).toEqual([]);
	});

	it('配列でないJSONは空配列を返す', () => {
		expect(parseCopyTemplates('{"label":"x","template":"y"}')).toEqual([]);
		expect(parseCopyTemplates('"string"')).toEqual([]);
		expect(parseCopyTemplates('null')).toEqual([]);
	});

	it('label や template が欠落した要素は除外する', () => {
		const raw = JSON.stringify([
			{ label: 'ok', template: 'x' },
			{ label: 'labelのみ' },
			{ template: 'templateのみ' },
			{}
		]);
		expect(parseCopyTemplates(raw)).toEqual([{ label: 'ok', template: 'x' }]);
	});

	it('label や template が非文字列の要素は除外する', () => {
		const raw = JSON.stringify([
			{ label: 1, template: 'x' },
			{ label: 'y', template: null },
			{ label: 'ok', template: 'z' },
			'string要素',
			42
		]);
		expect(parseCopyTemplates(raw)).toEqual([{ label: 'ok', template: 'z' }]);
	});
});
