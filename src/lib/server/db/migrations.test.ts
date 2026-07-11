import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migrations } from './migrations';
import { buildReportUrl, type ReportUrlContext } from '../reportUrl';
import { parseCopyTemplates } from '$lib/copyTemplates';
import { roundToHours } from '$lib/duration';

/**
 * in-memory DB に migrations を順次適用する。
 * beforeLast を渡すと最終マイグレーション（migration 3）の直前に実行する（旧設定の書き換え用）。
 */
function createMigratedDb(beforeLast?: (db: Database.Database) => void): Database.Database {
	const db = new Database(':memory:');
	for (let i = 0; i < migrations.length; i++) {
		if (i === migrations.length - 1) beforeLast?.(db);
		db.exec(migrations[i]);
	}
	return db;
}

function getSetting(db: Database.Database, key: string): string | undefined {
	const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
		| { value: string }
		| undefined;
	return row?.value;
}

/**
 * 移行元となる旧 form_* 設定の汎用ダミー値（等価性検証の期待値構築に使う）。
 * migration 1 のシードは空文字のため、テストでは createMigratedDb の hook で
 * この値を settings に注入してから migration 3 を適用する。
 */
const seed = {
	baseUrl: 'https://docs.google.com/forms/d/e/FORMID/viewform',
	entryName: 'entry.101',
	entryDate: 'entry.202',
	entryTitle: 'entry.303',
	entryJiraUrl: 'entry.404',
	entryProject: 'entry.505',
	entryProgress: 'entry.606',
	entryHours: 'entry.707'
};

/** hook 用: 旧 form_* キーをダミー値で UPSERT する（migration 3 適用直前に実行される）。 */
function injectLegacySeed(db: Database.Database): void {
	const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
	upsert.run('form_base_url', seed.baseUrl);
	upsert.run('form_entry_name', seed.entryName);
	upsert.run('form_entry_date', seed.entryDate);
	upsert.run('form_entry_title', seed.entryTitle);
	upsert.run('form_entry_jira_url', seed.entryJiraUrl);
	upsert.run('form_entry_project', seed.entryProject);
	upsert.run('form_entry_progress', seed.entryProgress);
	upsert.run('form_entry_hours', seed.entryHours);
}

const ctx: ReportUrlContext = {
	userName: '山田 太郎',
	projectName: '001: サンプル案件',
	workDate: '2026-07-10',
	ticketKey: 'TICKET-123',
	title: '請求書PDF 生成の不具合修正',
	jiraUrl: 'https://example.atlassian.net/browse/TICKET-123',
	progress: 80,
	finalSeconds: 2 * 3600 + 49 * 60 + 33,
	statusName: '進行中'
};

/**
 * 旧 buildFormUrl 相当の期待URLを URLSearchParams で再現する。
 * （旧実装 formUrl.ts は削除済みのため import せずテスト内で構築する）
 */
function buildLegacyExpectedUrl(c: ReportUrlContext): string {
	const [y, m, d] = c.workDate.split('-');
	const params = new URLSearchParams();
	params.set('usp', 'pp_url');
	params.set(seed.entryName, c.userName);
	params.set(`${seed.entryDate}_year`, String(Number(y)));
	params.set(`${seed.entryDate}_month`, String(Number(m)));
	params.set(`${seed.entryDate}_day`, String(Number(d)));
	params.set(seed.entryTitle, c.title);
	params.set(seed.entryJiraUrl, c.jiraUrl);
	params.set(seed.entryProject, c.projectName);
	params.set(seed.entryProgress, String(c.progress));
	params.set(seed.entryHours, String(roundToHours(c.finalSeconds)));
	return `${seed.baseUrl}?${params.toString()}`;
}

describe('migration 3', () => {
	it('生成された report_url_template が旧 buildFormUrl と意味的に等価なURLを生成する（デコード後パラメータのキー順込み一致。空白の + / %20 などバイト列の一致は保証しない）', () => {
		const db = createMigratedDb(injectLegacySeed);
		const template = getSetting(db, 'report_url_template');
		expect(template).toBeDefined();

		const actualUrl = buildReportUrl(template!, ctx);
		const expectedUrl = buildLegacyExpectedUrl(ctx);

		// ベースURL部分が一致する
		const actual = new URL(actualUrl);
		const expected = new URL(expectedUrl);
		expect(actual.origin + actual.pathname).toBe(expected.origin + expected.pathname);

		// デコード後の全パラメータがキー順込みで完全一致する（usp=pp_url 含む）
		expect(Array.from(actual.searchParams.entries())).toEqual(
			Array.from(expected.searchParams.entries())
		);
	});

	it('旧 form_* キー8個が削除されている', () => {
		const db = createMigratedDb(injectLegacySeed);
		const oldKeys = [
			'form_base_url',
			'form_entry_name',
			'form_entry_date',
			'form_entry_title',
			'form_entry_jira_url',
			'form_entry_project',
			'form_entry_progress',
			'form_entry_hours'
		];
		for (const key of oldKeys) {
			expect(getSetting(db, key), key).toBeUndefined();
		}
	});

	it('copy_templates に現行3種のテンプレートがシードされる', () => {
		const db = createMigratedDb();
		const raw = getSetting(db, 'copy_templates');
		expect(raw).toBeDefined();
		const templates = parseCopyTemplates(raw!);
		expect(templates).toEqual([
			{ label: 'ブランチ', template: 'feature/{ticket_key}' },
			{ label: 'PRタイトル', template: '[WIP][{ticket_key}]{title}' },
			{ label: 'テスト仕様書', template: '{ticket_key}_{title}' }
		]);
	});

	it('何も注入しない新規DB（シード空）では report_url_template が空文字になる（設定するまで報告リンク無効）', () => {
		const db = createMigratedDb();
		expect(getSetting(db, 'report_url_template')).toBe('');
	});

	it('form_base_url が空のDBでは report_url_template が空文字になる', () => {
		const db = createMigratedDb((d) => {
			injectLegacySeed(d);
			d.prepare("UPDATE settings SET value = '' WHERE key = 'form_base_url'").run();
		});
		expect(getSetting(db, 'report_url_template')).toBe('');
	});

	it('entry ID が空の項目はテンプレートから省略される（旧実装の壊れたパラメータ出力を正規化する意図的な非互換）', () => {
		const db = createMigratedDb((d) => {
			injectLegacySeed(d);
			d.prepare("UPDATE settings SET value = '' WHERE key = 'form_entry_jira_url'").run();
			d.prepare("UPDATE settings SET value = '' WHERE key = 'form_entry_date'").run();
		});
		const template = getSetting(db, 'report_url_template');
		expect(template).toBeDefined();
		// 省略された変数はテンプレートに現れない
		expect(template).not.toContain('{jira_url}');
		expect(template).not.toContain('{date_year}');
		expect(template).not.toContain('{date_month}');
		expect(template).not.toContain('{date_day}');
		// 他の項目は維持される
		expect(template).toContain('usp=pp_url');
		expect(template).toContain(`${seed.entryName}={user_name}`);
		expect(template).toContain(`${seed.entryHours}={hours}`);
		// 生成URLとしても空 entry ID 由来の壊れたパラメータ（`=値` のみ）が出ない
		const url = buildReportUrl(template!, ctx);
		const keys = Array.from(new URL(url).searchParams.keys());
		expect(keys).toEqual([
			'usp',
			seed.entryName,
			seed.entryTitle,
			seed.entryProject,
			seed.entryProgress,
			seed.entryHours
		]);
	});

	it('英数と . _ 以外を含む entry ID は空扱いで省略される（テンプレートへの区切り文字・変数の注入を防ぐ）', () => {
		const db = createMigratedDb((d) => {
			injectLegacySeed(d);
			d.prepare(
				"UPDATE settings SET value = 'entry.1&evil=1' WHERE key = 'form_entry_name'"
			).run();
			d.prepare("UPDATE settings SET value = 'entry.{title}' WHERE key = 'form_entry_hours'").run();
		});
		const template = getSetting(db, 'report_url_template');
		expect(template).toBeDefined();
		// 不正な entry ID の項目ごと省略され、注入も起きない
		expect(template).not.toContain('evil');
		expect(template).not.toContain('{user_name}');
		expect(template).not.toContain('{hours}');
		// 正常な entry ID の項目は維持される
		expect(template).toContain(`${seed.entryTitle}={title}`);
		expect(template).toContain(`${seed.entryDate}_year={date_year}`);
	});
});
