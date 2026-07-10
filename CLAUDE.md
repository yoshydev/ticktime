- 回答や思考過程は日本語で記載してください。

# プロジェクト概要

ticktime — チケット別の作業時間を管理する個人用ローカルツール。Googleスプレッドシート管理の置き換え。
タイマー計測 → 日次〆処理（確定・履歴ロック・Googleフォーム報告URL生成）→ 翌日再開、が基本サイクル。

- スタック: SvelteKit (Svelte 5 runes) + TypeScript + better-sqlite3
- ローカル起動専用・シングルユーザー。外部公開しない前提（認証なし）
- 実行環境: WSL2 + Node 24 直接実行（docker不使用）

# コマンド

- 起動: `npm run dev`（http://localhost:5173）
- 型チェック: `npm run check`（svelte-kit sync + svelte-check）
- テスト: `npm run test`（vitest。純関数のみ対象）
- CSVインポート: `node scripts/import-csv.ts <csvパス>`（既存キーはスキップ）
- DB確認: `sqlite3 data/ticktime.db`

# アーキテクチャ

- DBアクセスは `src/lib/server/repo/*.ts` に集約する。ルートから直接SQLを書かない
- 状態変更は原則 form actions + `use:enhance`。fetch APIは Jiraタイトル取得（`/api/jira/[key]`）のみ
- DB: `data/ticktime.db`（gitignore対象）。マイグレーションは `src/lib/server/db/migrations.ts` の配列に**追記**する（`PRAGMA user_version` 方式。適用済みの既存要素は変更しない）
- 純関数（`src/lib/workdate.ts` / `duration.ts` / `url.ts`、`formUrl.ts`、`closings.ts` の `computeInitialFinalSeconds`）にはvitestテストを付ける

# ドメインルール（変更時は要注意）

- **タイマー排他**: 走行中セッション（`ended_at IS NULL`）は全体で1本。DBの部分ユニークインデックスが最終防衛線。切替時は停止と開始に同一の `now` を使う
- **業務日付**: 境界はデフォルト朝5時JST（settings `day_boundary_hour`）。`work_date` は開始時刻基準で確定し、境界変更後も既存行は再計算しない
- **〆スナップショット**: `daily_entries` は〆時点のスナップショット（ticket_key/title/jira_url/status_name/form_url）。履歴表示はこれのみを参照し、後からのチケット・設定変更の影響を受けない
- **再〆の初期値**: `前回final + max(今回measured − 前回measured, 0)`。〆確定の対象集合はサーバー側で再構築する（クライアント送信の ticketIds を真実として扱わない）。final=0 の行は明細に含めない
- **フォームURL**: クエリは必ず `URLSearchParams` で組む。作業時間は1時間単位で四捨五入した整数
- **Jira認証**: `~/.config/jira/config` はサーバーサイドのみで読む。email/APIトークンをレスポンス・例外メッセージ・ログに出さない（ログはHTTPステータスのみ）

# 開発の進め方

- 実装にあたってはトークン効率化のため、サブエージェントを適切に切り出して実行し、メインセッションは設計と監査、レビューに専念すること（実装難易度が特に高い場合はメインセッションでの実装可）
- **Codexレビュー（必須）**: プラン完成後は `ExitPlanMode` 前にCodexへプランレビュー、実装完了後は品質チェック通過後にCodexへコードレビューを実施すること。指摘には自律的に対応し、スキップする場合は理由をユーザーに説明する
- 品質チェック: コミット前に `npm run check` と `npm run test` を通すこと

# Git

- コミットメッセージ: prefix（`feat:` `fix:` `refactor:` `chore:` など）を付ける。`Co-Authored-By` は付けない
- リモートなし（ローカルgitのみ）。push関連の操作は不要
