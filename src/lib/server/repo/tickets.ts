import { getDb } from '$lib/server/db';

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
		importedSeconds: r.imported_seconds
	};
}

const SELECT_BASE = `
  SELECT t.id, t.key, t.title, t.jira_url, t.status_id, t.progress, t.imported_seconds,
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

/**
 * チケットを追加する。title が空なら key を仮タイトルにする。
 * 既存 key と重複する場合はエラーを投げる。
 */
export function addTicket(input: { key: string; title?: string; jiraUrl?: string | null }): Ticket {
	const key = input.key.trim();
	if (key === '') throw new Error('チケット番号は必須です');
	const title = (input.title ?? '').trim() || key;
	const now = Date.now();
	const db = getDb();
	const info = db
		.prepare(
			`INSERT INTO tickets (key, title, jira_url, status_id, progress, imported_seconds, created_at, updated_at)
			 VALUES (?, ?, ?, ?, 0, 0, ?, ?)`
		)
		.run(key, title, input.jiraUrl ?? null, defaultStatusId(), now, now);
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
