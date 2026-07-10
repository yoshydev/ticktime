/**
 * 現行スプレッドシートの CSV から tickets を初期インポートする。
 *
 * 使い方:
 *   node scripts/import-csv.ts <csvパス>
 *
 * 取り込む列（ヘッダ名で位置を解決する）:
 *   チケット番号 / URL / タイトル / ステータス / time(h:mm:ss → imported_seconds) / 進捗
 *
 * 仕様:
 *   - ステータス名が statuses に完全一致しなければ「進行中」にフォールバック
 *   - 既存キーはスキップ（上書きしない）
 *   - 過去の日次明細は移行しない（累計 imported_seconds のみ）
 *
 * $lib エイリアスはスクリプトから使えないため better-sqlite3 を直接開く。
 * スキーマ整合のため migrations.ts（純粋な文字列配列・依存なし）を相対 import して適用する。
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrations } from '../src/lib/server/db/migrations.ts';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = resolve(PROJECT_ROOT, 'data', 'ticktime.db');
const FALLBACK_STATUS = '進行中';

/** ダブルクォート内のカンマ・改行を正しく扱う素朴な CSV パーサ。 */
function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;
	let started = false; // 空でない or 区切りを見たら行が始まったとみなす

	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += c;
			}
		} else if (c === '"') {
			inQuotes = true;
			started = true;
		} else if (c === ',') {
			row.push(field);
			field = '';
			started = true;
		} else if (c === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
			started = false;
		} else if (c === '\r') {
			// 無視（CRLF 対応）
		} else {
			field += c;
			started = true;
		}
	}
	if (started || field !== '') {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

/** h:mm:ss / h:mm / mm:ss 形式などを秒に変換する。不正なら 0。 */
function durationToSeconds(raw: string): number {
	const t = raw.trim();
	if (t === '') return 0;
	const parts = t.split(':').map((p) => p.trim());
	if (parts.some((p) => !/^\d+$/.test(p))) return 0;
	const nums = parts.map((p) => Number(p));
	let h = 0;
	let m = 0;
	let s = 0;
	if (nums.length === 3) [h, m, s] = nums;
	else if (nums.length === 2) [h, m] = nums;
	else if (nums.length === 1) [h] = nums;
	else return 0;
	return h * 3600 + m * 60 + s;
}

/** "50%" / "50" / "" などを 0〜100 の整数へ。不正・空は 0。 */
function parseProgress(raw: string): number {
	const t = raw.replace('%', '').trim();
	if (t === '') return 0;
	const n = Number.parseInt(t, 10);
	if (!Number.isFinite(n)) return 0;
	return Math.min(100, Math.max(0, n));
}

function findIndex(header: string[], name: string): number {
	return header.findIndex((h) => h.trim() === name);
}

function migrate(db: Database.Database): void {
	const current = db.pragma('user_version', { simple: true }) as number;
	for (let version = current; version < migrations.length; version++) {
		const sql = migrations[version];
		const nextVersion = version + 1;
		const run = db.transaction(() => {
			db.exec(sql);
			db.pragma(`user_version = ${nextVersion}`);
		});
		run();
	}
}

function main(): void {
	const csvPath = process.argv[2];
	if (!csvPath) {
		console.error('使い方: node scripts/import-csv.ts <csvパス>');
		process.exit(1);
	}

	const text = readFileSync(resolve(process.cwd(), csvPath), 'utf8');
	const rows = parseCsv(text);
	if (rows.length < 2) {
		console.error('CSV にデータ行がありません。');
		process.exit(1);
	}

	const header = rows[0];
	const idxKey = findIndex(header, 'チケット番号');
	const idxUrl = findIndex(header, 'URL');
	const idxTitle = findIndex(header, 'タイトル');
	const idxStatus = findIndex(header, 'ステータス');
	const idxTime = findIndex(header, 'time');
	const idxProgress = findIndex(header, '進捗');

	if (idxKey < 0 || idxTitle < 0) {
		console.error('必須列（チケット番号 / タイトル）がヘッダに見つかりません。');
		process.exit(1);
	}

	const db = new Database(DB_PATH);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	migrate(db);

	const statusIdByName = new Map<string, number>();
	for (const r of db.prepare('SELECT id, name FROM statuses').all() as {
		id: number;
		name: string;
	}[]) {
		statusIdByName.set(r.name, r.id);
	}
	const fallbackStatusId = statusIdByName.get(FALLBACK_STATUS);
	if (fallbackStatusId === undefined) {
		console.error(`フォールバック用ステータス「${FALLBACK_STATUS}」が statuses にありません。`);
		process.exit(1);
	}

	const jiraBrowseBase = (
		(db.prepare("SELECT value FROM settings WHERE key = 'jira_browse_base'").get() as
			| { value: string }
			| undefined)?.value ?? ''
	).trim();

	const exists = db.prepare('SELECT 1 FROM tickets WHERE key = ?');
	const insert = db.prepare(
		`INSERT INTO tickets (key, title, jira_url, status_id, progress, imported_seconds, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	);

	let imported = 0;
	let skipped = 0;
	const now = Date.now();

	const runImport = db.transaction(() => {
		for (let i = 1; i < rows.length; i++) {
			const row = rows[i];
			const key = (row[idxKey] ?? '').trim();
			if (key === '') {
				skipped++;
				continue;
			}
			if (exists.get(key)) {
				skipped++;
				continue;
			}

			const title = (row[idxTitle] ?? '').trim() || key;
			let jiraUrl = idxUrl >= 0 ? (row[idxUrl] ?? '').trim() : '';
			if (jiraUrl === '' && jiraBrowseBase !== '') {
				jiraUrl = jiraBrowseBase.endsWith('/')
					? `${jiraBrowseBase}${key}`
					: `${jiraBrowseBase}/${key}`;
			}
			const statusName = idxStatus >= 0 ? (row[idxStatus] ?? '').trim() : '';
			const statusId = statusIdByName.get(statusName) ?? fallbackStatusId;
			const seconds = idxTime >= 0 ? durationToSeconds(row[idxTime] ?? '') : 0;
			const progress = idxProgress >= 0 ? parseProgress(row[idxProgress] ?? '') : 0;

			insert.run(key, title, jiraUrl || null, statusId, progress, seconds, now, now);
			imported++;
		}
	});
	runImport();

	db.close();
	console.log(`インポート完了: 取込 ${imported} 件 / スキップ ${skipped} 件`);
}

main();
