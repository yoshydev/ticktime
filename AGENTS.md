- 回答や思考過程は日本語で記載してください。

# 踏襲すべきルール

プロジェクト概要・コマンド・アーキテクチャ・ドメインルールは @CLAUDE.md に集約している。必ず読み込んでからタスクに取り掛かること。

要点:
- SvelteKit (Svelte 5 runes) + better-sqlite3 のローカル専用個人ツール。DBアクセスは `src/lib/server/repo/` に集約、状態変更は form actions
- マイグレーションは `src/lib/server/db/migrations.ts` に追記のみ（適用済み要素は変更しない）
- Jiraのemail/APIトークン（`~/.config/jira/config`）をレスポンス・ログ・例外に出さない
- コミット前に `npm run check` と `npm run test` を通す
- コミットは prefix 付き・`Co-Authored-By` なし
