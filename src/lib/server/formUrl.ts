import { roundToHours } from '$lib/duration';

/**
 * Google フォームのプレフィルURL生成に必要な settings 値。
 * settings 依存を引数として受け取ることでテスト可能にしている。
 */
export interface FormUrlSettings {
	/** フォームのベースURL（`.../viewform` まで。クエリは付けない）。 */
	baseUrl: string;
	/** 氏名の entry ID（例: ``）。 */
	entryName: string;
	/** 報告日の entry ID（例: ``。`_year/_month/_day` サフィックスを付与）。 */
	entryDate: string;
	/** タイトルの entry ID。 */
	entryTitle: string;
	/** Jira URL の entry ID。 */
	entryJiraUrl: string;
	/** プロジェクト名の entry ID。 */
	entryProject: string;
	/** 進捗% の entry ID。 */
	entryProgress: string;
	/** 作業時間（整数時間）の entry ID。 */
	entryHours: string;
	/** 氏名（settings 由来。空でも可）。 */
	userName: string;
	/** プロジェクト名（settings 由来。例: `サンプル案件`）。 */
	projectName: string;
}

/** 1チケット分のプレフィル対象データ。 */
export interface FormUrlInput {
	/** 業務日付（`YYYY-MM-DD`）。 */
	workDate: string;
	/** タイトル。 */
	title: string;
	/** Jira URL（未設定なら空文字）。 */
	jiraUrl: string;
	/** 進捗%（整数）。 */
	progress: number;
	/** 確定作業時間（秒）。1時間単位で四捨五入して送る。 */
	finalSeconds: number;
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
 * settings 値とチケットデータから Google フォームのプレフィルURLを生成する。
 * クエリは全て `URLSearchParams` で組み立ててエンコードを担保する。
 * userName が空でもエラーにせず、空パラメータのまま生成する。
 */
export function buildFormUrl(settings: FormUrlSettings, input: FormUrlInput): string {
	const { year, month, day } = splitDate(input.workDate);
	const params = new URLSearchParams();
	params.set('usp', 'pp_url');
	params.set(settings.entryName, settings.userName);
	params.set(`${settings.entryDate}_year`, String(year));
	params.set(`${settings.entryDate}_month`, String(month));
	params.set(`${settings.entryDate}_day`, String(day));
	params.set(settings.entryTitle, input.title);
	params.set(settings.entryJiraUrl, input.jiraUrl);
	params.set(settings.entryProject, settings.projectName);
	params.set(settings.entryProgress, String(input.progress));
	params.set(settings.entryHours, String(roundToHours(input.finalSeconds)));
	return `${settings.baseUrl}?${params.toString()}`;
}
