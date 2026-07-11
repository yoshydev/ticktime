/**
 * デモ用 DB（data/demo.db）を毎回作り直してサンプルデータを投入する。
 *
 * 使い方:
 *   node scripts/demo-seed.ts          # demo.db を削除 → migrate → サンプル投入
 *   node scripts/demo-seed.ts --fresh  # demo.db を削除 → migrate のみ（実運用の初回起動と同一状態）
 *
 * 仕様:
 *   - DB パスは data/demo.db をハードコード（TICKTIME_DB 環境変数は一切参照しない）
 *   - 実DB誤爆防止の多重ガード（basename / data/ 配下 / 3ファイル個別確認）の上で削除する
 *   - サンプル: 設定・チケット6件・直近3営業日+当日のセッション・D-3/D-2 の〆済み履歴
 *   - 〆スナップショットは confirmClosing と同じ規則（final<=0 行なし・form_url/jira_url 非NULL）
 *   - 投入前後に self-check assert で整合性を検証する
 *
 * $lib エイリアスはスクリプトから使えないため better-sqlite3 を直接開く。
 * スキーマ整合のため migrations.ts（純粋な文字列配列・依存なし）を相対 import して適用する。
 */
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrations } from '../src/lib/server/db/migrations.ts';
import { toWorkDate } from '../src/lib/workdate.ts';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = resolve(PROJECT_ROOT, 'data');
const DB_PATH = resolve(DATA_DIR, 'demo.db');
/** 業務日付の境界時刻（migration 1 のシード値と同じ 5 時）。 */
const BOUNDARY_HOUR = 5;
const JIRA_BROWSE_BASE = 'https://example.atlassian.net/browse/';

/** self-check 用 assert。失敗したら即エラー終了する。 */
function assert(cond: boolean, message: string): void {
	if (!cond) {
		throw new Error(`self-check 失敗: ${message}`);
	}
}

/**
 * demo.db（WAL 3点セット）を削除する。
 * 実DB誤爆防止のため basename / data/ 配下 / 各ファイル名を個別に確認してから消す。
 */
function removeDemoDb(): void {
	assert(basename(DB_PATH) === 'demo.db', `削除対象が demo.db ではありません: ${DB_PATH}`);
	assert(
		DB_PATH.startsWith(DATA_DIR + sep),
		`削除対象が data/ 配下ではありません: ${DB_PATH}`
	);
	for (const suffix of ['', '-wal', '-shm']) {
		const target = DB_PATH + suffix;
		assert(
			basename(target) === `demo.db${suffix}`,
			`削除対象のファイル名が不正です: ${target}`
		);
		rmSync(target, { force: true });
	}
}

/** import-csv.ts と同じ user_version 方式で未適用マイグレーションを適用する。 */
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

/**
 * 業務日付 wd の JST hour:minute を epoch ミリ秒で返す。
 * hour には境界時刻（5時）未満を渡さないこと（意図した work_date とズレる。assert が最終防衛線）。
 */
function jstAt(wd: string, hour: number, minute: number): number {
	assert(hour >= BOUNDARY_HOUR, `jstAt に境界時刻未満の hour が渡されました: ${hour}`);
	return Date.parse(`${wd}T00:00:00Z`) + (hour - 9) * 3600e3 + minute * 60e3;
}

/** YYYY-MM-DD が土日か（JST の暦日として判定）。 */
function isWeekend(wd: string): boolean {
	const day = new Date(`${wd}T00:00:00Z`).getUTCDay();
	return day === 0 || day === 6;
}

/** YYYY-MM-DD の前日を返す。 */
function prevDay(wd: string): string {
	return new Date(Date.parse(`${wd}T00:00:00Z`) - 86400e3).toISOString().slice(0, 10);
}

interface TicketDef {
	key: string;
	title: string;
	statusName: string;
	progress: number;
	hasJiraUrl: boolean;
	importedSeconds: number;
}

/** サンプルチケット定義（各ステータスに分散・jira_url あり/なし混在・1件は imported_seconds あり）。 */
const TICKET_DEFS: TicketDef[] = [
	{
		key: 'DEMO-101',
		title: 'ログイン画面のバリデーション改修',
		statusName: '進行中',
		progress: 60,
		hasJiraUrl: true,
		importedSeconds: 0
	},
	{
		key: 'DEMO-102',
		title: 'ユーザー一覧にページネーションを追加',
		statusName: '進行中',
		progress: 30,
		hasJiraUrl: true,
		importedSeconds: 0
	},
	{
		key: 'DEMO-103',
		title: 'CSVエクスポート機能の新規実装',
		statusName: '確認中',
		progress: 90,
		hasJiraUrl: true,
		importedSeconds: 3600
	},
	{
		key: 'DEMO-104',
		title: '検索APIのレスポンス速度改善',
		statusName: '起票者質問中',
		progress: 40,
		hasJiraUrl: false,
		importedSeconds: 0
	},
	{
		key: 'DEMO-105',
		title: '旧管理画面からのデータ移行',
		statusName: '完了',
		progress: 100,
		hasJiraUrl: true,
		importedSeconds: 0
	},
	{
		key: 'DEMO-106',
		title: '通知メールの文言修正',
		statusName: '進行中',
		progress: 0,
		hasJiraUrl: false,
		importedSeconds: 0
	}
];

/** JST 固定時刻で表した過去日セッションの定義。 */
interface PastSessionSpec {
	key: string;
	startHour: number;
	startMinute: number;
	endHour: number;
	endMinute: number;
}

/** 投入するセッション1本（epoch 確定済み）。 */
interface SessionRow {
	key: string;
	startedAt: number;
	endedAt: number;
	workDate: string;
}

/** 過去日（D-3 / D-2 / D-1）のセッション計画。時間は 10〜18 時台の固定値で実行時刻に依存しない。 */
const PAST_SESSION_PLAN: PastSessionSpec[][] = [
	// D-3: 〆済みにする日。15分単位に揃わない長さにして measured ≠ final の見た目を作る
	[
		{ key: 'DEMO-101', startHour: 10, startMinute: 0, endHour: 12, endMinute: 5 },
		{ key: 'DEMO-103', startHour: 13, startMinute: 0, endHour: 15, endMinute: 40 },
		{ key: 'DEMO-105', startHour: 16, startMinute: 0, endHour: 17, endMinute: 10 }
	],
	// D-2: 〆済みにする日
	[
		{ key: 'DEMO-101', startHour: 10, startMinute: 0, endHour: 11, endMinute: 20 },
		{ key: 'DEMO-102', startHour: 11, startMinute: 30, endHour: 13, endMinute: 5 },
		{ key: 'DEMO-104', startHour: 14, startMinute: 0, endHour: 16, endMinute: 50 }
	],
	// D-1: 未〆のまま残す日（〆処理ページにやることが残る）
	[
		{ key: 'DEMO-102', startHour: 10, startMinute: 0, endHour: 12, endMinute: 25 },
		{ key: 'DEMO-103', startHour: 13, startMinute: 30, endHour: 14, endMinute: 20 },
		{ key: 'DEMO-106', startHour: 15, startMinute: 0, endHour: 16, endMinute: 5 }
	]
];

/** 設定のサンプル値（example.com の無害なテンプレート）。 */
const SETTING_VALUES: [string, string][] = [
	['user_name', 'デモ 太郎'],
	['project_name', 'デモプロジェクト'],
	[
		'report_url_template',
		'https://example.com/demo-report?name={user_name}&project={project_name}&date={date}&ticket={ticket_key}&title={title}&hours={hours}&progress={progress}&status={status}'
	],
	['jira_browse_base', JIRA_BROWSE_BASE]
];

/** 当日セッションを now 基準で組み立てる（開始は境界時刻以降にクランプ・終了は now 以前）。 */
function buildTodaySessions(now: number, todayWd: string): SessionRow[] {
	const boundary = jstAt(todayWd, BOUNDARY_HOUR, 0);
	// todayWd = toWorkDate(now) なので boundary <= now が成り立つ
	const span = now - boundary;
	assert(span >= 0, `当日の境界時刻が now より後です: boundary=${boundary} now=${now}`);
	// 窓幅に比例配置することで早朝実行（窓が狭い）でも境界〜now に収まる
	const at = (ratio: number): number => boundary + Math.floor(span * ratio);
	return [
		{ key: 'DEMO-101', startedAt: at(0.1), endedAt: at(0.45), workDate: todayWd },
		{ key: 'DEMO-102', startedAt: at(0.55), endedAt: at(0.9), workDate: todayWd }
	];
}

/** work_date × ticket_key ごとの計測秒数を JS のセッション定義配列から集計する（単一ソース）。 */
function measuredFromSessions(sessions: SessionRow[], workDate: string): Map<string, number> {
	const map = new Map<string, number>();
	for (const s of sessions) {
		if (s.workDate !== workDate) continue;
		const sec = Math.floor((s.endedAt - s.startedAt) / 1000);
		map.set(s.key, (map.get(s.key) ?? 0) + sec);
	}
	return map;
}

/** 15分単位で四捨五入した確定秒数（〆デモ用の見た目）。 */
function roundToQuarterHour(seconds: number): number {
	return Math.round(seconds / 900) * 900;
}

function seed(db: Database.Database): void {
	const now = Date.now();
	const todayWd = toWorkDate(now, BOUNDARY_HOUR);

	// 直近3営業日（新しい順: D-1, D-2, D-3）。土日はスキップする
	const pastDays: string[] = [];
	let d = prevDay(todayWd);
	while (pastDays.length < 3) {
		if (!isWeekend(d)) pastDays.push(d);
		d = prevDay(d);
	}
	const [dayMinus1, dayMinus2, dayMinus3] = pastDays;
	const planDays = [dayMinus3, dayMinus2, dayMinus1];

	// --- セッション（epoch を先に確定させる） ---
	const sessions: SessionRow[] = [];
	for (let i = 0; i < PAST_SESSION_PLAN.length; i++) {
		const wd = planDays[i];
		for (const spec of PAST_SESSION_PLAN[i]) {
			sessions.push({
				key: spec.key,
				startedAt: jstAt(wd, spec.startHour, spec.startMinute),
				endedAt: jstAt(wd, spec.endHour, spec.endMinute),
				workDate: wd
			});
		}
	}
	sessions.push(...buildTodaySessions(now, todayWd));

	// --- self-check（投入前）: work_date の帰属と時刻の前後関係を検証 ---
	for (const s of sessions) {
		assert(
			toWorkDate(s.startedAt, BOUNDARY_HOUR) === s.workDate,
			`セッションの work_date がズレています: ${s.key} ${s.workDate}`
		);
		assert(s.endedAt >= s.startedAt, `セッションの終了が開始より前です: ${s.key} ${s.workDate}`);
		assert(s.endedAt <= now, `セッションの終了が未来です: ${s.key} ${s.workDate}`);
	}

	const tx = db.transaction(() => {
		// --- settings（ON CONFLICT DO UPDATE 直書き） ---
		const upsertSetting = db.prepare(
			'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
		);
		for (const [key, value] of SETTING_VALUES) upsertSetting.run(key, value);

		// --- tickets（status_id は name で SELECT 解決） ---
		const statusIdByName = new Map<string, number>();
		for (const r of db.prepare('SELECT id, name FROM statuses').all() as {
			id: number;
			name: string;
		}[]) {
			statusIdByName.set(r.name, r.id);
		}
		const insertTicket = db.prepare(
			`INSERT INTO tickets (key, title, jira_url, status_id, progress, imported_seconds, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const ticketIdByKey = new Map<string, number>();
		for (const t of TICKET_DEFS) {
			const statusId = statusIdByName.get(t.statusName);
			assert(statusId !== undefined, `ステータス「${t.statusName}」が statuses にありません`);
			const info = insertTicket.run(
				t.key,
				t.title,
				t.hasJiraUrl ? `${JIRA_BROWSE_BASE}${t.key}` : null,
				statusId,
				t.progress,
				t.importedSeconds,
				now,
				now
			);
			ticketIdByKey.set(t.key, Number(info.lastInsertRowid));
		}

		// --- sessions（全行 ended_at NOT NULL: 走行中1本ユニークインデックス対策） ---
		const insertSession = db.prepare(
			'INSERT INTO sessions (ticket_id, started_at, ended_at, work_date) VALUES (?, ?, ?, ?)'
		);
		for (const s of sessions) {
			insertSession.run(ticketIdByKey.get(s.key), s.startedAt, s.endedAt, s.workDate);
		}

		// --- D-3 / D-2 の〆（confirmClosing と同じスナップショット規則） ---
		const insertClosing = db.prepare(
			'INSERT INTO daily_closings (work_date, closed_at) VALUES (?, ?)'
		);
		const insertEntry = db.prepare(
			`INSERT INTO daily_entries
			   (closing_id, ticket_id, measured_seconds, final_seconds, progress,
			    ticket_key, title, jira_url, status_name, form_url)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		for (const wd of [dayMinus3, dayMinus2]) {
			const info = insertClosing.run(wd, jstAt(wd, 18, 30));
			const closingId = Number(info.lastInsertRowid);
			// measured は JS のセッション定義配列から集計する（DB との二重管理をしない）
			const measured = measuredFromSessions(sessions, wd);
			for (const t of TICKET_DEFS) {
				const m = measured.get(t.key);
				if (m === undefined) continue;
				const finalSeconds = roundToQuarterHour(m);
				// final <= 0 の行は明細に含めない（confirmClosing と同じ）
				if (finalSeconds <= 0) continue;
				insertEntry.run(
					closingId,
					ticketIdByKey.get(t.key),
					m,
					finalSeconds,
					t.progress,
					t.key,
					t.title,
					// daily_entries.jira_url は NOT NULL のため、URL なしチケットは ''
					t.hasJiraUrl ? `${JIRA_BROWSE_BASE}${t.key}` : '',
					t.statusName,
					// 実運用の〆は report_url_template から form_url を生成する。テンプレート展開ロジックは
					// スクリプトに複製せず、見た目が等価な固定URL（example.com）を直接入れる
					`https://example.com/report?ticket=${encodeURIComponent(t.key)}&date=${wd}&hours=${Math.round(finalSeconds / 3600)}`
				);
			}
		}
	});
	tx();

	// --- self-check（投入後）: 〆スナップショットと DB 実データの整合を検証 ---
	const closingCount = db.prepare('SELECT COUNT(*) AS c FROM daily_closings').get() as {
		c: number;
	};
	assert(closingCount.c === 2, `daily_closings が 2 件ではありません: ${closingCount.c}`);

	const nullCount = db
		.prepare(
			'SELECT COUNT(*) AS c FROM daily_entries WHERE form_url IS NULL OR jira_url IS NULL'
		)
		.get() as { c: number };
	assert(nullCount.c === 0, 'daily_entries に form_url / jira_url が NULL の行があります');

	const entryRows = db
		.prepare(
			`SELECT e.ticket_id, e.measured_seconds, c.work_date
			 FROM daily_entries e JOIN daily_closings c ON c.id = e.closing_id`
		)
		.all() as { ticket_id: number; measured_seconds: number; work_date: string }[];
	const sumStmt = db.prepare(
		`SELECT COALESCE(SUM(ended_at - started_at), 0) AS ms
		 FROM sessions WHERE work_date = ? AND ticket_id = ? AND ended_at IS NOT NULL`
	);
	for (const e of entryRows) {
		const row = sumStmt.get(e.work_date, e.ticket_id) as { ms: number };
		const dbSeconds = Math.floor(row.ms / 1000);
		assert(
			dbSeconds === e.measured_seconds,
			`daily_entries.measured_seconds がセッション集計と不一致: ticket_id=${e.ticket_id} ${e.work_date} (${e.measured_seconds} != ${dbSeconds})`
		);
	}

	// --- 件数ログ ---
	const count = (table: string): number =>
		(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
	console.log(
		`デモデータ投入完了: tickets ${count('tickets')} 件 / sessions ${count('sessions')} 件 / ` +
			`daily_closings ${count('daily_closings')} 件 / daily_entries ${count('daily_entries')} 件`
	);
	console.log(`対象日: ${dayMinus3}（〆済）/ ${dayMinus2}（〆済）/ ${dayMinus1}（未〆）/ ${todayWd}（当日）`);
}

function main(): void {
	const args = process.argv.slice(2);
	const fresh = args[0] === '--fresh';
	if (args.length > 1 || (args.length === 1 && !fresh)) {
		console.error('使い方: node scripts/demo-seed.ts [--fresh]');
		process.exit(1);
	}

	removeDemoDb();

	const db = new Database(DB_PATH);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	migrate(db);

	if (fresh) {
		console.log(`demo.db を初期状態で再作成しました（サンプルデータなし）: ${DB_PATH}`);
	} else {
		seed(db);
	}
	db.close();
}

main();
