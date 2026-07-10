import { getDb } from '$lib/server/db';

export interface Status {
	id: number;
	name: string;
	kind: 'active' | 'pending' | 'done';
	sortOrder: number;
}

/** 全設定を key→value のマップで返す。 */
export function getAllSettings(): Record<string, string> {
	const rows = getDb().prepare('SELECT key, value FROM settings').all() as {
		key: string;
		value: string;
	}[];
	const map: Record<string, string> = {};
	for (const r of rows) map[r.key] = r.value;
	return map;
}

/** 単一設定値を返す（未設定なら fallback）。 */
export function getSetting(key: string, fallback = ''): string {
	const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
		| { value: string }
		| undefined;
	return row?.value ?? fallback;
}

/** 業務日付の境界時刻（数値）。不正値は 5 にフォールバック。 */
export function getBoundaryHour(): number {
	const raw = getSetting('day_boundary_hour', '5');
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n >= 0 && n <= 23 ? n : 5;
}

/**
 * 設定値をまとめて upsert する（1トランザクション）。
 * 渡されたキーのみ更新し、未指定のキーは変更しない。
 */
export function updateSettings(values: Record<string, string>): void {
	const db = getDb();
	const stmt = db.prepare(
		'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
	);
	const tx = db.transaction((entries: [string, string][]) => {
		for (const [k, v] of entries) stmt.run(k, v);
	});
	tx(Object.entries(values));
}

/** 全ステータスを sort_order 昇順で返す。 */
export function listStatuses(): Status[] {
	const rows = getDb()
		.prepare('SELECT id, name, kind, sort_order FROM statuses ORDER BY sort_order, id')
		.all() as { id: number; name: string; kind: Status['kind']; sort_order: number }[];
	return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, sortOrder: r.sort_order }));
}

/** ステータスを追加する。name 重複時は UNIQUE 制約でエラーになる。 */
export function addStatus(name: string, kind: Status['kind'], sortOrder: number): void {
	getDb()
		.prepare('INSERT INTO statuses (name, kind, sort_order) VALUES (?, ?, ?)')
		.run(name, kind, sortOrder);
}

/** ステータスを更新する。 */
export function updateStatus(
	id: number,
	name: string,
	kind: Status['kind'],
	sortOrder: number
): void {
	getDb()
		.prepare('UPDATE statuses SET name = ?, kind = ?, sort_order = ? WHERE id = ?')
		.run(name, kind, sortOrder, id);
}

/** 指定 ID のステータスが存在するか。 */
export function statusExists(id: number): boolean {
	const row = getDb().prepare('SELECT 1 FROM statuses WHERE id = ? LIMIT 1').get(id);
	return !!row;
}

/** このステータスを参照している tickets が存在するか。 */
export function isStatusUsed(id: number): boolean {
	const row = getDb().prepare('SELECT 1 FROM tickets WHERE status_id = ? LIMIT 1').get(id);
	return !!row;
}

/** ステータスを削除する。tickets から参照されている場合はエラーを投げる。 */
export function deleteStatus(id: number): void {
	if (isStatusUsed(id)) {
		throw new Error('このステータスは使用中のため削除できません');
	}
	getDb().prepare('DELETE FROM statuses WHERE id = ?').run(id);
}
