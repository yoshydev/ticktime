/**
 * マイグレーション定義。
 * 配列のインデックス+1 が user_version に対応する（migrations[0] = version 1）。
 * 起動時に `PRAGMA user_version` より後ろの分をトランザクションで順次適用する。
 * 各 SQL 文字列は 1 マイグレーションとして単一トランザクションで実行される。
 */
export const migrations: string[] = [
	// --- migration 1: 初期スキーマ + シード ---
	`
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE statuses (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL CHECK (kind IN ('active','pending','done')),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tickets (
  id               INTEGER PRIMARY KEY,
  key              TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  jira_url         TEXT,
  status_id        INTEGER NOT NULL REFERENCES statuses(id),
  progress         INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  imported_seconds INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE sessions (
  id         INTEGER PRIMARY KEY,
  ticket_id  INTEGER NOT NULL REFERENCES tickets(id),
  started_at INTEGER NOT NULL,
  ended_at   INTEGER CHECK (ended_at IS NULL OR ended_at >= started_at),
  work_date  TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_sessions_one_running ON sessions ((1)) WHERE ended_at IS NULL;
CREATE INDEX idx_sessions_work_date ON sessions (work_date);

CREATE TABLE daily_closings (
  id        INTEGER PRIMARY KEY,
  work_date TEXT NOT NULL UNIQUE,
  closed_at INTEGER NOT NULL
);

CREATE TABLE daily_entries (
  id               INTEGER PRIMARY KEY,
  closing_id       INTEGER NOT NULL REFERENCES daily_closings(id) ON DELETE CASCADE,
  ticket_id        INTEGER NOT NULL REFERENCES tickets(id),
  measured_seconds INTEGER NOT NULL CHECK (measured_seconds >= 0),
  final_seconds    INTEGER NOT NULL CHECK (final_seconds >= 0),
  progress         INTEGER NOT NULL,
  ticket_key       TEXT NOT NULL,
  title            TEXT NOT NULL,
  jira_url         TEXT NOT NULL,
  status_name      TEXT NOT NULL,
  form_url         TEXT NOT NULL,
  UNIQUE (closing_id, ticket_id)
);

-- ステータスのシード
INSERT OR IGNORE INTO statuses (name, kind, sort_order) VALUES
  ('進行中',     'active',  10),
  ('確認中',     'active',  20),
  ('起票者質問中','pending', 30),
  ('完了',       'done',    40);

-- 設定のシード（個人情報は空文字。設定画面で入力する）
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('user_name',            ''),
  ('project_name',         'サンプル案件'),
  ('form_base_url',        ''),
  ('form_entry_name',      ''),
  ('form_entry_date',      ''),
  ('form_entry_title',     ''),
  ('form_entry_jira_url',  ''),
  ('form_entry_project',   ''),
  ('form_entry_progress',  ''),
  ('form_entry_hours',     ''),
  ('jira_browse_base',     ''),
  ('day_boundary_hour',    '5');
`,
	// --- migration 2: jira_browse_base の既定値埋め（空のままの既存DB向け） ---
	`
UPDATE settings
SET value = 'https://example.atlassian.net/browse/'
WHERE key = 'jira_browse_base' AND value = '';
`
];
