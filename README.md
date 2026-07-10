# ticktime

チケット別の作業時間を管理するローカル専用ツール。従来 Google スプレッドシートで行っていた
日次の作業時間記録・ステータス管理・ブランチ名/PR タイトル/テスト仕様書名の生成・作業報告フォームの
プレフィル URL 生成を 1 つのローカルアプリに集約する。

- タイマー計測（同時 1 本。開始で前のタイマーを自動停止。DB が真実なのでリロード/再起動で復元）
- チケット管理（番号・タイトル・Jira URL・ステータス・進捗%）
- 日次〆処理・履歴参照（Phase 2 以降）
- ワンクリックコピー: `feature/<KEY>` / `[WIP][<KEY>]<タイトル>` / `<KEY>_<タイトル>`

スタック: SvelteKit (Svelte 5 runes, TypeScript) + better-sqlite3。API サーバー分離なし、SvelteKit 単体で完結。

## 起動

```bash
npm install
npm run dev
```

`http://localhost:5173/` を開く。ローカル利用のみを想定（リモートデプロイなし）。

## その他のコマンド

```bash
npm run check   # svelte-check による型チェック
npm run test    # vitest（workdate / duration などの純関数テスト）
npm run build   # 本番ビルド（現状 adapter-auto）
```

## データベース

- 実体: `data/ticktime.db`（SQLite, WAL モード）。`data/` は gitignore 対象（`data/.gitkeep` のみコミット）
- 初回起動時に `data/` ディレクトリと DB を自動生成し、`PRAGMA user_version` 方式でマイグレーションを適用する
- 時刻は epoch ミリ秒、業務日付は JST 基準の `YYYY-MM-DD`。業務日付の境界時刻はデフォルト 05:00（設定で変更可）
- 中身の確認: `sqlite3 data/ticktime.db`

## better-sqlite3 のネイティブビルドについて

better-sqlite3 はネイティブアドオンをビルドするため、`npm install` 時に C++ ツールチェインが必要になる
場合がある。ビルドに失敗する場合は以下相当を用意する（Debian/Ubuntu 系 WSL2）:

```bash
sudo apt-get install -y build-essential python3
```

その後 `npm rebuild better-sqlite3` で再ビルドできる。

## 開発環境

- WSL2 / Node v24.11.1 を想定
