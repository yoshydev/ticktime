import { getDb } from '$lib/server/db';
import { toWorkDate } from '$lib/workdate';
import { getBoundaryHour } from './settings';

export interface RunningSession {
	id: number;
	ticketId: number;
	ticketKey: string;
	ticketTitle: string;
	startedAt: number;
	workDate: string;
}

/** 走行中（ended_at IS NULL）のセッションを1件返す。なければ null。 */
export function getRunning(): RunningSession | null {
	const row = getDb()
		.prepare(
			`SELECT sess.id, sess.ticket_id, sess.started_at, sess.work_date,
			        t.key AS ticket_key, t.title AS ticket_title
			 FROM sessions sess
			 JOIN tickets t ON t.id = sess.ticket_id
			 WHERE sess.ended_at IS NULL`
		)
		.get() as
		| {
				id: number;
				ticket_id: number;
				started_at: number;
				work_date: string;
				ticket_key: string;
				ticket_title: string;
		  }
		| undefined;
	if (!row) return null;
	return {
		id: row.id,
		ticketId: row.ticket_id,
		ticketKey: row.ticket_key,
		ticketTitle: row.ticket_title,
		startedAt: row.started_at,
		workDate: row.work_date
	};
}

/**
 * 指定チケットの計測を開始する。
 * 1トランザクションで「走行中を全停止 → 新規INSERT」を行い、
 * 停止時刻と新規開始時刻には同一の now を使う（隙間・重複を作らない）。
 */
export function start(ticketId: number): void {
	const db = getDb();
	const boundary = getBoundaryHour();
	const tx = db.transaction(() => {
		const now = Date.now();
		db.prepare('UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL').run(now);
		db.prepare(
			'INSERT INTO sessions (ticket_id, started_at, ended_at, work_date) VALUES (?, ?, NULL, ?)'
		).run(ticketId, now, toWorkDate(now, boundary));
	});
	tx();
}

/** 走行中セッションを停止する。走行中がなければ何もしない。 */
export function stop(): void {
	getDb().prepare('UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL').run(Date.now());
}

/**
 * 指定業務日付の、チケット別の計測秒数を返す（走行中は now までを加算）。
 * @returns Map<ticketId, seconds>
 */
export function secondsByTicketForDate(workDate: string): Map<number, number> {
	const now = Date.now();
	const rows = getDb()
		.prepare(
			`SELECT ticket_id, SUM(COALESCE(ended_at, ?) - started_at) AS ms
			 FROM sessions WHERE work_date = ? GROUP BY ticket_id`
		)
		.all(now, workDate) as { ticket_id: number; ms: number }[];
	const map = new Map<number, number>();
	for (const r of rows) map.set(r.ticket_id, Math.floor((r.ms ?? 0) / 1000));
	return map;
}

/** 現在（今）の業務日付を返す。 */
export function currentWorkDate(): string {
	return toWorkDate(Date.now(), getBoundaryHour());
}

/** 対象業務日付で、指定タイムスタンプより後に開始したセッションが存在するか。 */
export function hasSessionStartedAfter(workDate: string, timestamp: number): boolean {
	const row = getDb()
		.prepare('SELECT 1 FROM sessions WHERE work_date = ? AND started_at > ? LIMIT 1')
		.get(workDate, timestamp);
	return !!row;
}
