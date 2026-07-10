import { getDb } from '$lib/server/db';
import { getAllSettings } from './settings';
import { buildFormUrl, type FormUrlSettings } from '$lib/server/formUrl';

/** 〆ドラフトの1行（チケット別）。 */
export interface ClosingDraftRow {
	ticketId: number;
	ticketKey: string;
	title: string;
	jiraUrl: string;
	/** 対象日 sessions の全量計測（走行中は除外）。 */
	measuredSeconds: number;
	/** 確定時間の初期値（再〆差分ルール適用済み）。 */
	initialFinalSeconds: number;
	progress: number;
	statusId: number;
	statusName: string;
}

/** 〆ドラフト全体。 */
export interface ClosingDraft {
	workDate: string;
	/** 既に〆済みか（＝再〆になるか）。 */
	isClosed: boolean;
	closedAt: number | null;
	/** 対象日に走行中セッションが存在するか。 */
	hasRunning: boolean;
	runningTicketKey: string | null;
	rows: ClosingDraftRow[];
}

/** confirm に渡す1行分の入力。measured はサーバー側で再計算する。 */
export interface ClosingEntryInput {
	ticketId: number;
	finalSeconds: number;
	progress: number;
	statusId: number;
}

/** 確定後に返す明細（フォームURL付き）。 */
export interface ClosedEntry {
	ticketId: number;
	ticketKey: string;
	title: string;
	jiraUrl: string;
	measuredSeconds: number;
	finalSeconds: number;
	progress: number;
	statusName: string;
	formUrl: string;
}

/**
 * 対象業務日付の、チケット別「確定済み」計測秒数（走行中は除外）を返す。
 * @returns Map<ticketId, seconds>
 */
function measuredByTicketForDate(workDate: string): Map<number, number> {
	const rows = getDb()
		.prepare(
			`SELECT ticket_id, SUM(ended_at - started_at) AS ms
			 FROM sessions
			 WHERE work_date = ? AND ended_at IS NOT NULL
			 GROUP BY ticket_id`
		)
		.all(workDate) as { ticket_id: number; ms: number }[];
	const map = new Map<number, number>();
	for (const r of rows) map.set(r.ticket_id, Math.floor((r.ms ?? 0) / 1000));
	return map;
}

/** 対象日に走行中セッションがあれば、そのチケットキーを返す（なければ null）。 */
function runningOnDate(workDate: string): string | null {
	const row = getDb()
		.prepare(
			`SELECT t.key AS key
			 FROM sessions sess JOIN tickets t ON t.id = sess.ticket_id
			 WHERE sess.work_date = ? AND sess.ended_at IS NULL`
		)
		.get(workDate) as { key: string } | undefined;
	return row?.key ?? null;
}

interface ClosingRow {
	id: number;
	work_date: string;
	closed_at: number;
}

/** 対象日の daily_closings 行を返す（なければ null）。 */
function findClosing(workDate: string): ClosingRow | null {
	const row = getDb()
		.prepare('SELECT id, work_date, closed_at FROM daily_closings WHERE work_date = ?')
		.get(workDate) as ClosingRow | undefined;
	return row ?? null;
}

interface PrevEntry {
	ticket_id: number;
	measured_seconds: number;
	final_seconds: number;
	progress: number;
}

/** 再〆初期値の計算に必要な前回明細の抜粋。 */
export interface PrevFinalSnapshot {
	measuredSeconds: number;
	finalSeconds: number;
}

/**
 * 確定時間の初期値を計算する（純関数・DB非依存）。
 * - 前回明細あり: 前回final + max(今回measured − 前回measured, 0)
 * - 前回明細なし（初回〆）: 今回measured をそのまま
 */
export function computeInitialFinalSeconds(
	measuredSeconds: number,
	prev: PrevFinalSnapshot | null
): number {
	if (prev) return prev.finalSeconds + Math.max(measuredSeconds - prev.measuredSeconds, 0);
	return measuredSeconds;
}

/** 対象closingの既存明細を ticket_id→{measured,final,progress} で返す。 */
function prevEntriesByTicket(closingId: number): Map<number, PrevEntry> {
	const rows = getDb()
		.prepare(
			`SELECT ticket_id, measured_seconds, final_seconds, progress
			 FROM daily_entries WHERE closing_id = ?`
		)
		.all(closingId) as PrevEntry[];
	const map = new Map<number, PrevEntry>();
	for (const r of rows) map.set(r.ticket_id, r);
	return map;
}

interface TicketSnap {
	id: number;
	key: string;
	title: string;
	jira_url: string | null;
	progress: number;
	status_id: number;
	status_name: string;
}

/**
 * 対象業務日付の〆ドラフトを構築する。
 * - 計測: 対象日 sessions の全量SUM（走行中除外）
 * - 対象行: 対象日に計測のあるチケット ∪ 既存明細のチケット
 * - 再〆初期値: 前回final + max(今回measured − 前回measured, 0)（初回〆は measured がそのまま）
 */
export function getClosingDraft(workDate: string): ClosingDraft {
	const db = getDb();
	const measured = measuredByTicketForDate(workDate);
	const closing = findClosing(workDate);
	const prev = closing ? prevEntriesByTicket(closing.id) : new Map<number, PrevEntry>();

	const ticketIds = new Set<number>([...measured.keys(), ...prev.keys()]);

	const rows: ClosingDraftRow[] = [];
	for (const ticketId of ticketIds) {
		const t = db
			.prepare(
				`SELECT t.id, t.key, t.title, t.jira_url, t.progress, t.status_id, s.name AS status_name
				 FROM tickets t JOIN statuses s ON s.id = t.status_id WHERE t.id = ?`
			)
			.get(ticketId) as TicketSnap | undefined;
		const m = measured.get(ticketId) ?? 0;
		const p = prev.get(ticketId);

		const initialFinal = computeInitialFinalSeconds(
			m,
			p ? { measuredSeconds: p.measured_seconds, finalSeconds: p.final_seconds } : null
		);

		if (t) {
			rows.push({
				ticketId,
				ticketKey: t.key,
				title: t.title,
				jiraUrl: t.jira_url ?? '',
				measuredSeconds: m,
				initialFinalSeconds: initialFinal,
				progress: p ? p.progress : t.progress,
				statusId: t.status_id,
				statusName: t.status_name
			});
		}
	}

	rows.sort((a, b) => a.ticketKey.localeCompare(b.ticketKey));

	const runningKey = runningOnDate(workDate);

	return {
		workDate,
		isClosed: !!closing,
		closedAt: closing?.closed_at ?? null,
		hasRunning: runningKey !== null,
		runningTicketKey: runningKey,
		rows
	};
}

function formUrlSettings(s: Record<string, string>): FormUrlSettings {
	return {
		baseUrl: s.form_base_url ?? '',
		entryName: s.form_entry_name ?? '',
		entryDate: s.form_entry_date ?? '',
		entryTitle: s.form_entry_title ?? '',
		entryJiraUrl: s.form_entry_jira_url ?? '',
		entryProject: s.form_entry_project ?? '',
		entryProgress: s.form_entry_progress ?? '',
		entryHours: s.form_entry_hours ?? '',
		userName: s.user_name ?? '',
		projectName: s.project_name ?? ''
	};
}

/**
 * 対象業務日付の〆を確定する（1トランザクション）。
 * - 冒頭で対象日の走行中セッションを再チェックし、あれば abort（エラー送出）
 * - daily_closings upsert → 対象closingの明細を全DELETE→INSERT
 * - 対象集合はサーバー側で再構築する（送信 inputs を真実として扱わない）。
 *   対象 = 今回計測のあるチケット ∪ 既存明細のチケット。
 *   inputs に含まれないチケットはサーバー側初期値で補完する
 *   （final=前回entryありなら getClosingDraft と同じ再〆初期値、なければ今回measured。
 *    progress / status は現在のチケット値。本体の更新はしない）。
 * - measured はサーバー側で再計算。final_seconds=0 の行は明細に含めない
 * - ユーザー入力があった行のみ tickets.progress / status_id を同一トランザクションで更新
 * @returns 明細スナップショット一覧（フォームURL付き。final=0 は含まない）
 */
export function confirmClosing(workDate: string, inputs: ClosingEntryInput[]): ClosedEntry[] {
	const db = getDb();
	const fus = formUrlSettings(getAllSettings());

	const tx = db.transaction((): ClosedEntry[] => {
		// 走行中の再チェック（別タブ・二重送信対策）
		if (runningOnDate(workDate) !== null) {
			throw new Error('対象日に走行中のタイマーがあります。停止してから確定してください。');
		}

		const now = Date.now();
		const measured = measuredByTicketForDate(workDate);

		// daily_closings upsert
		const existing = findClosing(workDate);
		let closingId: number;
		if (existing) {
			db.prepare('UPDATE daily_closings SET closed_at = ? WHERE id = ?').run(now, existing.id);
			closingId = existing.id;
		} else {
			const info = db
				.prepare('INSERT INTO daily_closings (work_date, closed_at) VALUES (?, ?)')
				.run(workDate, now);
			closingId = Number(info.lastInsertRowid);
		}
		const prev = existing ? prevEntriesByTicket(existing.id) : new Map<number, PrevEntry>();

		// 明細を全置換
		db.prepare('DELETE FROM daily_entries WHERE closing_id = ?').run(closingId);

		const insertEntry = db.prepare(
			`INSERT INTO daily_entries
			   (closing_id, ticket_id, measured_seconds, final_seconds, progress,
			    ticket_key, title, jira_url, status_name, form_url)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const updateTicket = db.prepare(
			'UPDATE tickets SET progress = ?, status_id = ?, updated_at = ? WHERE id = ?'
		);

		// 対象集合をサーバー側で再構築（送信 inputs を真実にしない）
		const inputsByTicket = new Map<number, ClosingEntryInput>();
		for (const input of inputs) inputsByTicket.set(input.ticketId, input);
		const targetIds = new Set<number>([...measured.keys(), ...prev.keys()]);

		const result: ClosedEntry[] = [];
		for (const ticketId of targetIds) {
			// チケット本体（自身の status を含む）を取得
			const base = db
				.prepare(
					`SELECT t.id, t.key, t.title, t.jira_url, t.progress, t.status_id
					 FROM tickets t WHERE t.id = ?`
				)
				.get(ticketId) as
				| {
						id: number;
						key: string;
						title: string;
						jira_url: string | null;
						progress: number;
						status_id: number;
				  }
				| undefined;
			if (!base) continue;

			const m = measured.get(ticketId) ?? 0;
			const p = prev.get(ticketId);
			const submitted = inputsByTicket.get(ticketId);

			let finalSeconds: number;
			let progress: number;
			let statusId: number;
			if (submitted) {
				finalSeconds = submitted.finalSeconds;
				progress = submitted.progress;
				statusId = submitted.statusId;
			} else {
				// 送信 inputs に無いチケットはサーバー側初期値で補完する
				finalSeconds = computeInitialFinalSeconds(
					m,
					p ? { measuredSeconds: p.measured_seconds, finalSeconds: p.final_seconds } : null
				);
				progress = base.progress;
				statusId = base.status_id;
			}

			// status 名を解決（不正 statusId の行はスキップ＝明細にも本体更新にも反映しない）
			const status = db.prepare('SELECT id, name FROM statuses WHERE id = ?').get(statusId) as
				| { id: number; name: string }
				| undefined;
			if (!status) continue;

			// ステータス・進捗はチケット本体へ反映（final=0 でも反映する）。
			// ユーザー入力があった行のみ更新し、補完行は現在値のまま触らない。
			if (submitted) {
				updateTicket.run(progress, statusId, now, ticketId);
			}

			// 確定値0秒はその日作業なし扱いで明細に含めない
			if (finalSeconds <= 0) continue;

			const jiraUrl = base.jira_url ?? '';
			const formUrl = buildFormUrl(fus, {
				workDate,
				title: base.title,
				jiraUrl,
				progress,
				finalSeconds
			});

			insertEntry.run(
				closingId,
				ticketId,
				m,
				finalSeconds,
				progress,
				base.key,
				base.title,
				jiraUrl,
				status.name,
				formUrl
			);

			result.push({
				ticketId,
				ticketKey: base.key,
				title: base.title,
				jiraUrl,
				measuredSeconds: m,
				finalSeconds,
				progress,
				statusName: status.name,
				formUrl
			});
		}

		result.sort((a, b) => a.ticketKey.localeCompare(b.ticketKey));
		return result;
	});

	return tx();
}

/** 履歴一覧の1行（〆済み日付ごとの集計）。 */
export interface ClosingSummary {
	workDate: string;
	closedAt: number;
	ticketCount: number;
	totalFinalSeconds: number;
}

/** 〆済み日付を降順で返す（チケット数・合計final時間つき）。 */
export function listClosings(): ClosingSummary[] {
	const rows = getDb()
		.prepare(
			`SELECT c.work_date, c.closed_at,
			        COUNT(e.id) AS ticket_count,
			        COALESCE(SUM(e.final_seconds), 0) AS total_final
			 FROM daily_closings c
			 LEFT JOIN daily_entries e ON e.closing_id = c.id
			 GROUP BY c.id
			 ORDER BY c.work_date DESC`
		)
		.all() as {
		work_date: string;
		closed_at: number;
		ticket_count: number;
		total_final: number;
	}[];
	return rows.map((r) => ({
		workDate: r.work_date,
		closedAt: r.closed_at,
		ticketCount: r.ticket_count,
		totalFinalSeconds: r.total_final
	}));
}

/** 履歴詳細の明細1行（スナップショット）。 */
export interface ClosingDetailEntry {
	ticketKey: string;
	title: string;
	jiraUrl: string;
	finalSeconds: number;
	progress: number;
	statusName: string;
	formUrl: string;
}

/** 指定日の明細を返す（〆済みでなければ null）。 */
export function getClosingDetail(
	workDate: string
): { workDate: string; closedAt: number; entries: ClosingDetailEntry[] } | null {
	const closing = findClosing(workDate);
	if (!closing) return null;
	const rows = getDb()
		.prepare(
			`SELECT ticket_key, title, jira_url, final_seconds, progress, status_name, form_url
			 FROM daily_entries WHERE closing_id = ? ORDER BY ticket_key`
		)
		.all(closing.id) as {
		ticket_key: string;
		title: string;
		jira_url: string;
		final_seconds: number;
		progress: number;
		status_name: string;
		form_url: string;
	}[];
	return {
		workDate: closing.work_date,
		closedAt: closing.closed_at,
		entries: rows.map((r) => ({
			ticketKey: r.ticket_key,
			title: r.title,
			jiraUrl: r.jira_url,
			finalSeconds: r.final_seconds,
			progress: r.progress,
			statusName: r.status_name,
			formUrl: r.form_url
		}))
	};
}

/** 指定業務日付が〆済みか。 */
export function isClosed(workDate: string): boolean {
	return findClosing(workDate) !== null;
}

/**
 * 対象業務日付の〆情報を返す（〆済みなら closedAt と daily_entries.measured_seconds 合計）。
 * 未〆なら null。今日ページの「再〆が必要か」判定に使う。
 */
export function getClosingInfo(
	workDate: string
): { closedAt: number; measuredTotalSeconds: number } | null {
	const closing = findClosing(workDate);
	if (!closing) return null;
	const row = getDb()
		.prepare(
			'SELECT COALESCE(SUM(measured_seconds), 0) AS total FROM daily_entries WHERE closing_id = ?'
		)
		.get(closing.id) as { total: number };
	return { closedAt: closing.closed_at, measuredTotalSeconds: row.total };
}
