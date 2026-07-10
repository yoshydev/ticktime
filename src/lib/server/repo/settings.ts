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

/** 全ステータスを sort_order 昇順で返す。 */
export function listStatuses(): Status[] {
	const rows = getDb()
		.prepare('SELECT id, name, kind, sort_order FROM statuses ORDER BY sort_order, id')
		.all() as { id: number; name: string; kind: Status['kind']; sort_order: number }[];
	return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, sortOrder: r.sort_order }));
}
