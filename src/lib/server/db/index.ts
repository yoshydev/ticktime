import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { migrations } from './migrations';

const DB_PATH = resolve(process.cwd(), 'data', 'ticktime.db');

let _db: Database.Database | null = null;

/**
 * 未適用のマイグレーションを user_version 方式で順次適用する。
 * 各マイグレーションは個別トランザクションで実行し、成功後に user_version を更新する。
 */
function migrate(db: Database.Database): void {
	const current = db.pragma('user_version', { simple: true }) as number;
	for (let version = current; version < migrations.length; version++) {
		const sql = migrations[version];
		const nextVersion = version + 1;
		const run = db.transaction(() => {
			db.exec(sql);
			// user_version は PRAGMA でしか設定できず、バインドパラメータを受け付けないため
			// マイグレーション番号を直接埋め込む（数値であることは自明で安全）。
			db.pragma(`user_version = ${nextVersion}`);
		});
		run();
	}
}

/**
 * SQLite への接続をプロセス内シングルトンとして返す。
 * 初回呼び出しで data ディレクトリ作成・PRAGMA 設定・マイグレーションを行う。
 */
export function getDb(): Database.Database {
	if (_db) return _db;

	const dir = dirname(DB_PATH);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	const db = new Database(DB_PATH);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	migrate(db);

	_db = db;
	return _db;
}
