import { roundToHours } from '$lib/duration';
import { renderTemplate } from '$lib/template';

/** 報告URLテンプレートで使用できる変数名（バリデーション用）。 */
export const REPORT_URL_VARS = [
	'user_name',
	'project_name',
	'date',
	'date_year',
	'date_month',
	'date_day',
	'ticket_key',
	'title',
	'jira_url',
	'hours',
	'progress',
	'status'
] as const;

/** 報告URL生成に必要な1チケット分のコンテキスト。 */
export interface ReportUrlContext {
	/** 氏名（settings 由来。空でも可）。 */
	userName: string;
	/** プロジェクト名（settings 由来）。 */
	projectName: string;
	/** 業務日付（`YYYY-MM-DD`）。 */
	workDate: string;
	/** チケットキー。 */
	ticketKey: string;
	/** タイトル。 */
	title: string;
	/** Jira URL（未設定なら空文字）。 */
	jiraUrl: string;
	/** 進捗%（整数）。 */
	progress: number;
	/** 確定作業時間（秒）。`{hours}` は1時間単位で四捨五入して埋める。 */
	finalSeconds: number;
	/** ステータス名。 */
	statusName: string;
}

/**
 * `YYYY-MM-DD` を数値の {year, month, day} に分解する。
 * 月・日はゼロ埋めしない（Google フォームの日付欄仕様に合わせる）。
 */
function splitDate(workDate: string): { year: number; month: number; day: number } {
	const [y, m, d] = workDate.split('-');
	return { year: Number(y), month: Number(m), day: Number(d) };
}

/**
 * 報告URLテンプレートとチケットデータから報告URLを生成する。
 * テンプレートが空（trim 後）なら `''` を返す（報告リンク機能の無効化）。
 * 各変数値は `encodeURIComponent` でエンコードして埋め込む。
 */
export function buildReportUrl(template: string, ctx: ReportUrlContext): string {
	if (template.trim() === '') return '';
	const { year, month, day } = splitDate(ctx.workDate);
	const vars: Record<string, string> = {
		user_name: ctx.userName,
		project_name: ctx.projectName,
		date: ctx.workDate,
		date_year: String(year),
		date_month: String(month),
		date_day: String(day),
		ticket_key: ctx.ticketKey,
		title: ctx.title,
		jira_url: ctx.jiraUrl,
		hours: String(roundToHours(ctx.finalSeconds)),
		progress: String(ctx.progress),
		status: ctx.statusName
	};
	return renderTemplate(template, vars, encodeURIComponent);
}
