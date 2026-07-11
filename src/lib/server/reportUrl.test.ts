import { describe, it, expect } from 'vitest';
import { buildReportUrl, type ReportUrlContext } from './reportUrl';

/** 移行後のテンプレート形式（旧 buildFormUrl と同じパラメータ順。entry ID は架空のダミー）。 */
const formTemplate =
	'https://docs.google.com/forms/d/e/FORMID/viewform?usp=pp_url' +
	'&entry.101={user_name}' +
	'&entry.202_year={date_year}' +
	'&entry.202_month={date_month}' +
	'&entry.202_day={date_day}' +
	'&entry.303={title}' +
	'&entry.404={jira_url}' +
	'&entry.505={project_name}' +
	'&entry.606={progress}' +
	'&entry.707={hours}';

const baseCtx: ReportUrlContext = {
	userName: '山田 太郎',
	projectName: '001: サンプル案件',
	workDate: '2026-07-10',
	ticketKey: 'TICKET-123',
	title: 'タイトル',
	jiraUrl: '',
	progress: 50,
	finalSeconds: 3600,
	statusName: '進行中'
};

function paramsOf(url: string): URLSearchParams {
	return new URL(url).searchParams;
}

describe('buildReportUrl', () => {
	it('日付を year/month/day に分解し、月・日はゼロ埋めしない', () => {
		const url = buildReportUrl(formTemplate, baseCtx);
		const p = paramsOf(url);
		expect(p.get('entry.202_year')).toBe('2026');
		expect(p.get('entry.202_month')).toBe('7');
		expect(p.get('entry.202_day')).toBe('10');
	});

	it('1桁の月・日でもゼロ埋めしない', () => {
		const url = buildReportUrl(formTemplate, { ...baseCtx, workDate: '2026-01-05' });
		const p = paramsOf(url);
		expect(p.get('entry.202_month')).toBe('1');
		expect(p.get('entry.202_day')).toBe('5');
	});

	it('作業時間を1時間単位で四捨五入した整数にする', () => {
		// 2:49:33 → 3
		const url = buildReportUrl(formTemplate, {
			...baseCtx,
			finalSeconds: 2 * 3600 + 49 * 60 + 33
		});
		expect(paramsOf(url).get('entry.707')).toBe('3');
	});

	it('1:29 は 1、1:30 は 2 に丸める', () => {
		const u1 = buildReportUrl(formTemplate, { ...baseCtx, finalSeconds: 1 * 3600 + 29 * 60 });
		const u2 = buildReportUrl(formTemplate, { ...baseCtx, finalSeconds: 1 * 3600 + 30 * 60 });
		expect(paramsOf(u1).get('entry.707')).toBe('1');
		expect(paramsOf(u2).get('entry.707')).toBe('2');
	});

	it('日本語タイトルと氏名を URL エンコードして復元できる', () => {
		const url = buildReportUrl(formTemplate, {
			...baseCtx,
			title: '請求書PDF 生成の不具合修正',
			jiraUrl: 'https://example.atlassian.net/browse/TICKET-123',
			progress: 80
		});
		// 生の日本語がそのまま出ずにパーセントエンコードされている
		expect(url).not.toContain('請求書');
		expect(url).toContain('usp=pp_url');
		const p = paramsOf(url);
		expect(p.get('entry.303')).toBe('請求書PDF 生成の不具合修正');
		expect(p.get('entry.101')).toBe('山田 太郎');
		expect(p.get('entry.404')).toBe('https://example.atlassian.net/browse/TICKET-123');
		expect(p.get('entry.505')).toBe('001: サンプル案件');
		expect(p.get('entry.606')).toBe('80');
	});

	it('userName が空でもエラーにせず空パラメータで生成する', () => {
		const url = buildReportUrl(formTemplate, { ...baseCtx, userName: '' });
		expect(paramsOf(url).get('entry.101')).toBe('');
	});

	it('テンプレートが空（trim 後）なら空文字を返す', () => {
		expect(buildReportUrl('', baseCtx)).toBe('');
		expect(buildReportUrl('   ', baseCtx)).toBe('');
	});

	it('jiraUrl が空なら空パラメータで生成する', () => {
		const url = buildReportUrl(formTemplate, { ...baseCtx, jiraUrl: '' });
		expect(paramsOf(url).get('entry.404')).toBe('');
	});

	it('{date} {ticket_key} {status} を置換できる', () => {
		const url = buildReportUrl(
			'https://example.com/report?d={date}&k={ticket_key}&s={status}',
			baseCtx
		);
		const p = paramsOf(url);
		expect(p.get('d')).toBe('2026-07-10');
		expect(p.get('k')).toBe('TICKET-123');
		expect(p.get('s')).toBe('進行中');
	});

	it('一部の変数のみ使ったテンプレートでも生成できる', () => {
		const url = buildReportUrl('https://example.com/?h={hours}', baseCtx);
		expect(url).toBe('https://example.com/?h=1');
	});
});
