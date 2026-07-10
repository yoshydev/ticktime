import { getDb } from '$lib/server/db';
import { getSetting } from './settings';

export interface Ticket {
	id: number;
	key: string;
	title: string;
	jiraUrl: string | null;
	statusId: number;
	statusName: string;
	statusKind: 'active' | 'pending' | 'done';
	progress: number;
	importedSeconds: number;
	createdAt: number;
}

interface TicketRow {
	id: number;
	key: string;
	title: string;
	jira_url: string | null;
	status_id: number;
	status_name: string;
	status_kind: Ticket['statusKind'];
	progress: number;
	imported_seconds: number;
	created_at: number;
}

function mapRow(r: TicketRow): Ticket {
	return {
		id: r.id,
		key: r.key,
		title: r.title,
		jiraUrl: r.jira_url,
		statusId: r.status_id,
		statusName: r.status_name,
		statusKind: r.status_kind,
		progress: r.progress,
		importedSeconds: r.imported_seconds,
		createdAt: r.created_at
	};
}

const SELECT_BASE = `
  SELECT t.id, t.key, t.title, t.jira_url, t.status_id, t.progress, t.imported_seconds, t.created_at,
         s.name AS status_name, s.kind AS status_kind
  FROM tickets t
  JOIN statuses s ON s.id = t.status_id
`;

/** active / pending のチケットを、ステータスの sort_order 順で返す（done は除外）。 */
export function listOpenTickets(): Ticket[] {
	const rows = getDb()
		.prepare(
			`${SELECT_BASE} WHERE s.kind IN ('active','pending') ORDER BY s.sort_order, s.id, t.key`
		)
		.all() as TicketRow[];
	return rows.map(mapRow);
}

/** 全チケットを返す。 */
export function listAllTickets(): Ticket[] {
	const rows = getDb()
		.prepare(`${SELECT_BASE} ORDER BY s.sort_order, s.id, t.key`)
		.all() as TicketRow[];
	return rows.map(mapRow);
}

/** 指定 ID のチケットが存在するか。 */
export function ticketExists(id: number): boolean {
	const row = getDb().prepare('SELECT 1 FROM tickets WHERE id = ? LIMIT 1').get(id);
	return !!row;
}

export function getTicket(id: number): Ticket | null {
	const row = getDb().prepare(`${SELECT_BASE} WHERE t.id = ?`).get(id) as TicketRow | undefined;
	return row ? mapRow(row) : null;
}

export function findByKey(key: string): Ticket | null {
	const row = getDb().prepare(`${SELECT_BASE} WHERE t.key = ?`).get(key) as TicketRow | undefined;
	return row ? mapRow(row) : null;
}

/** 新規チケット追加時のデフォルトステータス（active の最小 sort_order、なければ任意の1件）。 */
function defaultStatusId(): number {
	const db = getDb();
	const active = db
		.prepare("SELECT id FROM statuses WHERE kind = 'active' ORDER BY sort_order, id LIMIT 1")
		.get() as { id: number } | undefined;
	if (active) return active.id;
	const any = db.prepare('SELECT id FROM statuses ORDER BY sort_order, id LIMIT 1').get() as
		| { id: number }
		| undefined;
	if (!any) throw new Error('ステータスが1件も存在しません');
	return any.id;
}

/** jira_browse_base 設定とキーから Jira URL を導出する。base が空なら null。 */
export function deriveJiraUrl(key: string): string | null {
	const base = getSetting('jira_browse_base').trim();
	if (base === '') return null;
	return base.endsWith('/') ? `${base}${key}` : `${base}/${key}`;
}

/**
 * チケットを追加する。title が空なら key を仮タイトルにする。
 * jiraUrl が空の場合は jira_browse_base 設定 + key から導出して保存する。
 * 既存 key と重複する場合はエラーを投げる。
 */
export function addTicket(input: { key: string; title?: string; jiraUrl?: string | null }): Ticket {
	const key = input.key.trim();
	if (key === '') throw new Error('チケット番号は必須です');
	const title = (input.title ?? '').trim() || key;
	const jiraUrl = (input.jiraUrl ?? '').trim() || deriveJiraUrl(key);
	const now = Date.now();
	const db = getDb();
	const info = db
		.prepare(
			`INSERT INTO tickets (key, title, jira_url, status_id, progress, imported_seconds, created_at, updated_at)
			 VALUES (?, ?, ?, ?, 0, 0, ?, ?)`
		)
		.run(key, title, jiraUrl, defaultStatusId(), now, now);
	const created = getTicket(Number(info.lastInsertRowid));
	if (!created) throw new Error('チケット作成に失敗しました');
	return created;
}

/** ステータスを変更する。 */
export function setStatus(ticketId: number, statusId: number): void {
	getDb()
		.prepare('UPDATE tickets SET status_id = ?, updated_at = ? WHERE id = ?')
		.run(statusId, Date.now(), ticketId);
}

/**
 * チケットを更新する（キー・タイトル・Jira URL・ステータス・進捗）。
 * key/title は trim 必須（title が空なら key を仮タイトルにする、addTicket と同様の方針）。
 * key の UNIQUE 制約違反はそのまま throw する（呼び出し側でメッセージ変換する）。
 */
export function updateTicket(input: {
	id: number;
	key: string;
	title: string;
	jiraUrl: string | null;
	statusId: number;
	progress: number;
}): void {
	const key = input.key.trim();
	if (key === '') throw new Error('チケット番号は必須です');
	const title = input.title.trim() || key;
	getDb()
		.prepare(
			`UPDATE tickets SET key = ?, title = ?, jira_url = ?, status_id = ?, progress = ?, updated_at = ?
			 WHERE id = ?`
		)
		.run(key, title, input.jiraUrl, input.statusId, input.progress, Date.now(), input.id);
}

/** 指定チケットが sessions または daily_entries から参照されているか（計測履歴の有無）。 */
export function isTicketReferenced(id: number): boolean {
	const db = getDb();
	const inSessions = db.prepare('SELECT 1 FROM sessions WHERE ticket_id = ? LIMIT 1').get(id);
	if (inSessions) return true;
	const inEntries = db.prepare('SELECT 1 FROM daily_entries WHERE ticket_id = ? LIMIT 1').get(id);
	return !!inEntries;
}

/** sessions / daily_entries から参照されている ticket_id をまとめて返す。 */
export function referencedTicketIds(): Set<number> {
	const db = getDb();
	const ids = new Set<number>();
	for (const r of db.prepare('SELECT DISTINCT ticket_id AS id FROM sessions').all() as {
		id: number;
	}[]) {
		ids.add(r.id);
	}
	for (const r of db.prepare('SELECT DISTINCT ticket_id AS id FROM daily_entries').all() as {
		id: number;
	}[]) {
		ids.add(r.id);
	}
	return ids;
}

/** チケットを削除する。計測履歴（sessions/daily_entries）があれば削除不可としてエラーを投げる。 */
export function deleteTicket(id: number): void {
	if (isTicketReferenced(id)) {
		throw new Error('このチケットは計測履歴があるため削除できません');
	}
	getDb().prepare('DELETE FROM tickets WHERE id = ?').run(id);
}

/** チケット別累計時間の1行。 */
export interface TicketCumulative {
	ticketId: number;
	key: string;
	title: string;
	statusName: string;
	/** imported_seconds + SUM(daily_entries.final_seconds) + 未〆日のsessions実測。 */
	totalSeconds: number;
}

/**
 * 全チケットの累計作業時間を返す。
 * 累計 = imported_seconds + Σ(daily_entries.final_seconds) + 未〆日の sessions 実測（走行中は now まで）。
 * totalSeconds 降順、同値はキー昇順。
 */
export function cumulativeByTicket(): TicketCumulative[] {
	const db = getDb();
	const now = Date.now();

	const finalByTicket = new Map<number, number>();
	for (const r of db
		.prepare('SELECT ticket_id, SUM(final_seconds) AS s FROM daily_entries GROUP BY ticket_id')
		.all() as { ticket_id: number; s: number }[]) {
		finalByTicket.set(r.ticket_id, r.s ?? 0);
	}

	// 未〆日（daily_closings に work_date が存在しない）の sessions 実測
	const unclosedByTicket = new Map<number, number>();
	for (const r of db
		.prepare(
			`SELECT ticket_id, SUM(COALESCE(ended_at, ?) - started_at) AS ms
			 FROM sessions
			 WHERE work_date NOT IN (SELECT work_date FROM daily_closings)
			 GROUP BY ticket_id`
		)
		.all(now) as { ticket_id: number; ms: number }[]) {
		unclosedByTicket.set(r.ticket_id, Math.floor((r.ms ?? 0) / 1000));
	}

	const rows = db
		.prepare(
			`SELECT t.id, t.key, t.title, t.imported_seconds, s.name AS status_name
			 FROM tickets t JOIN statuses s ON s.id = t.status_id`
		)
		.all() as {
		id: number;
		key: string;
		title: string;
		imported_seconds: number;
		status_name: string;
	}[];

	const result: TicketCumulative[] = rows.map((r) => ({
		ticketId: r.id,
		key: r.key,
		title: r.title,
		statusName: r.status_name,
		totalSeconds:
			r.imported_seconds + (finalByTicket.get(r.id) ?? 0) + (unclosedByTicket.get(r.id) ?? 0)
	}));

	result.sort((a, b) => b.totalSeconds - a.totalSeconds || a.key.localeCompare(b.key));
	return result;
}
