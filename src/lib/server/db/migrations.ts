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

-- 設定のシード（個人・環境固有の値はすべて空文字。設定画面で入力する）
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('user_name',            ''),
  ('project_name',         ''),
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
	// --- migration 2: （欠番・no-op） ---
	// かつて jira_browse_base に環境固有の既定値を埋めていたが、配布準備で除去した。
	// 要素数 = user_version の対応を維持するため、配列要素は削除せず無害な no-op にしている。
	`
UPDATE settings SET value = value WHERE 0;
`,
	// --- migration 3: フォームURL設定をテンプレート方式に移行 + コピーテンプレートのシード ---
	// 旧 form_base_url / form_entry_* から report_url_template を合成して旧キーを削除する（不可逆）。
	// - 旧キーの読み出しは COALESCE で防御（キー欠損時の NULL 伝播で value NOT NULL に抵触するのを防ぐ）
	// - パラメータ順は旧 buildFormUrl の params.set 順を厳守:
	//   usp=pp_url → name → date_year/_month/_day → title → jira_url → project → progress → hours
	// - form_base_url が空ならテンプレートは ''（機能無効化）。entry ID が空の項目は省略に正規化（意図的な非互換）
	// - entry ID は英数と . _ のみを有効とし、それ以外（& = # % { } 等を含む値）は空扱いで省略する
	//   （テンプレートへの区切り文字・変数の注入を防ぐ。旧設定画面は entry ID を検証していなかったため）
	`
INSERT OR IGNORE INTO settings (key, value)
SELECT
  'report_url_template',
  CASE WHEN base = '' THEN '' ELSE
    base || '?usp=pp_url'
    || CASE WHEN e_name     = '' THEN '' ELSE '&' || e_name || '={user_name}' END
    || CASE WHEN e_date     = '' THEN '' ELSE
         '&' || e_date || '_year={date_year}'
         || '&' || e_date || '_month={date_month}'
         || '&' || e_date || '_day={date_day}'
       END
    || CASE WHEN e_title    = '' THEN '' ELSE '&' || e_title    || '={title}' END
    || CASE WHEN e_jira     = '' THEN '' ELSE '&' || e_jira     || '={jira_url}' END
    || CASE WHEN e_project  = '' THEN '' ELSE '&' || e_project  || '={project_name}' END
    || CASE WHEN e_progress = '' THEN '' ELSE '&' || e_progress || '={progress}' END
    || CASE WHEN e_hours    = '' THEN '' ELSE '&' || e_hours    || '={hours}' END
  END
FROM (
  SELECT
    base,
    CASE WHEN e_name     GLOB '*[^A-Za-z0-9._]*' THEN '' ELSE e_name     END AS e_name,
    CASE WHEN e_date     GLOB '*[^A-Za-z0-9._]*' THEN '' ELSE e_date     END AS e_date,
    CASE WHEN e_title    GLOB '*[^A-Za-z0-9._]*' THEN '' ELSE e_title    END AS e_title,
    CASE WHEN e_jira     GLOB '*[^A-Za-z0-9._]*' THEN '' ELSE e_jira     END AS e_jira,
    CASE WHEN e_project  GLOB '*[^A-Za-z0-9._]*' THEN '' ELSE e_project  END AS e_project,
    CASE WHEN e_progress GLOB '*[^A-Za-z0-9._]*' THEN '' ELSE e_progress END AS e_progress,
    CASE WHEN e_hours    GLOB '*[^A-Za-z0-9._]*' THEN '' ELSE e_hours    END AS e_hours
  FROM (
    SELECT
      COALESCE((SELECT value FROM settings WHERE key = 'form_base_url'),       '') AS base,
      COALESCE((SELECT value FROM settings WHERE key = 'form_entry_name'),     '') AS e_name,
      COALESCE((SELECT value FROM settings WHERE key = 'form_entry_date'),     '') AS e_date,
      COALESCE((SELECT value FROM settings WHERE key = 'form_entry_title'),    '') AS e_title,
      COALESCE((SELECT value FROM settings WHERE key = 'form_entry_jira_url'), '') AS e_jira,
      COALESCE((SELECT value FROM settings WHERE key = 'form_entry_project'),  '') AS e_project,
      COALESCE((SELECT value FROM settings WHERE key = 'form_entry_progress'), '') AS e_progress,
      COALESCE((SELECT value FROM settings WHERE key = 'form_entry_hours'),    '') AS e_hours
  )
);

DELETE FROM settings WHERE key IN (
  'form_base_url',
  'form_entry_name',
  'form_entry_date',
  'form_entry_title',
  'form_entry_jira_url',
  'form_entry_project',
  'form_entry_progress',
  'form_entry_hours'
);

-- コピー用テンプレートのシード（従来のブランチ名/PRタイトル/テスト仕様書名ボタンを維持）
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('copy_templates', '[{"label":"ブランチ","template":"feature/{ticket_key}"},{"label":"PRタイトル","template":"[WIP][{ticket_key}]{title}"},{"label":"テスト仕様書","template":"{ticket_key}_{title}"}]');
`
];
