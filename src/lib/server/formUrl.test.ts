import { describe, it, expect } from 'vitest';
import { buildFormUrl, type FormUrlSettings } from './formUrl';

const settings: FormUrlSettings = {
	baseUrl: 'https://docs.google.com/forms/d/e/FORMID/viewform',
	entryName: '',
	entryDate: '',
	entryTitle: '',
	entryJiraUrl: '',
	entryProject: '',
	entryProgress: '',
	entryHours: '',
	userName: '山田 太郎',
	projectName: 'サンプル案件'
};

function paramsOf(url: string): URLSearchParams {
	return new URL(url).searchParams;
}

describe('buildFormUrl', () => {
	it('日付を year/month/day に分解し、月・日はゼロ埋めしない', () => {
		const url = buildFormUrl(settings, {
			workDate: '2026-07-10',
			title: 'タイトル',
			jiraUrl: '',
			progress: 50,
			finalSeconds: 3600
		});
		const p = paramsOf(url);
		expect(p.get('_year')).toBe('2026');
		expect(p.get('_month')).toBe('7');
		expect(p.get('_day')).toBe('10');
	});

	it('1桁の月・日でもゼロ埋めしない', () => {
		const url = buildFormUrl(settings, {
			workDate: '2026-01-05',
			title: 'x',
			jiraUrl: '',
			progress: 0,
			finalSeconds: 0
		});
		const p = paramsOf(url);
		expect(p.get('_month')).toBe('1');
		expect(p.get('_day')).toBe('5');
	});

	it('作業時間を1時間単位で四捨五入した整数にする', () => {
		// 2:49:33 → 3
		const url = buildFormUrl(settings, {
			workDate: '2026-07-10',
			title: 'x',
			jiraUrl: '',
			progress: 0,
			finalSeconds: 2 * 3600 + 49 * 60 + 33
		});
		expect(paramsOf(url).get('')).toBe('3');
	});

	it('1:29 は 1、1:30 は 2 に丸める', () => {
		const u1 = buildFormUrl(settings, {
			workDate: '2026-07-10',
			title: 'x',
			jiraUrl: '',
			progress: 0,
			finalSeconds: 1 * 3600 + 29 * 60
		});
		const u2 = buildFormUrl(settings, {
			workDate: '2026-07-10',
			title: 'x',
			jiraUrl: '',
			progress: 0,
			finalSeconds: 1 * 3600 + 30 * 60
		});
		expect(paramsOf(u1).get('')).toBe('1');
		expect(paramsOf(u2).get('')).toBe('2');
	});

	it('日本語タイトルと氏名を URL エンコードして復元できる', () => {
		const url = buildFormUrl(settings, {
			workDate: '2026-07-10',
			title: '請求書PDF 生成の不具合修正',
			jiraUrl: 'https://example.atlassian.net/browse/TICKET-1234',
			progress: 80,
			finalSeconds: 3600
		});
		// 生の日本語がそのまま出ずにパーセントエンコードされている
		expect(url).not.toContain('請求書');
		expect(url).toContain('usp=pp_url');
		const p = paramsOf(url);
		expect(p.get('')).toBe('請求書PDF 生成の不具合修正');
		expect(p.get('')).toBe('山田 太郎');
		expect(p.get('')).toBe(
			'https://example.atlassian.net/browse/TICKET-1234'
		);
		expect(p.get('')).toBe('サンプル案件');
		expect(p.get('')).toBe('80');
	});

	it('userName が空でもエラーにせず空パラメータで生成する', () => {
		const url = buildFormUrl(
			{ ...settings, userName: '' },
			{ workDate: '2026-07-10', title: 'x', jiraUrl: '', progress: 0, finalSeconds: 0 }
		);
		expect(paramsOf(url).get('')).toBe('');
	});
});
