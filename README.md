# ticktime

チケット別の作業時間を管理するローカル専用ツール。従来 Google スプレッドシートで行っていた
日次の作業時間記録・ステータス管理・ブランチ名/PR タイトル/テスト仕様書名の生成・作業報告フォームの
プレフィル URL 生成を 1 つのローカルアプリに集約する。

- タイマー計測（同時 1 本。開始で前のタイマーを自動停止。DB が真実なのでリロード/再起動で復元）
- チケット管理（番号・タイトル・Jira URL・ステータス・進捗%）
- 日次〆処理・履歴参照（Phase 2 以降）
- ワンクリックコピー: `feature/<KEY>` / `[WIP][<KEY>]<タイトル>` / `<KEY>_<タイトル>`

スタック: SvelteKit (Svelte 5 runes, TypeScript) + better-sqlite3。API サーバー分離なし、SvelteKit 単体で完結。

## 利用（npx）

```bash
npx @yoshydev/ticktime            # http://localhost:8425 で起動
npx @yoshydev/ticktime --open     # 起動後にブラウザを開く
npx @yoshydev/ticktime --port 9000
```

ローカル利用のみを想定（リモートデプロイなし）。`http://localhost:<port>` / `http://127.0.0.1:<port>` /
`http://[::1]:<port>` のいずれでもアクセス可能。フォーム送信はループバックホストからの
同一オリジンのみ受け付ける（外部サイトからのクロスサイトPOSTやループバック以外のホスト名は403で拒否）。

### フラグ・環境変数

| フラグ | 環境変数 | デフォルト | 説明 |
| --- | --- | --- | --- |
| `--port <n>` | `PORT` | `8425` | リッスンポート（フラグが環境変数より優先） |
| `--db <path>` | `TICKTIME_DB` | 下記参照 | SQLite DB ファイルのパス |
| `--open` | — | off | 起動後にブラウザで開く |
| — | `HOST` | `127.0.0.1` | バインドアドレス（外部非公開デフォルト） |
| — | `ORIGIN` | `http://localhost:<port>` | POST の origin 検証に使うオリジン |
| — | `BODY_SIZE_LIMIT` | adapter-node 既定 | リクエストボディ上限 |

`--help` / `--version` も利用可。

## 開発

```bash
npm install
npm run dev
```

`http://localhost:5173/` を開く。

### その他のコマンド

```bash
npm run check   # svelte-check による型チェック
npm run test    # vitest（workdate / duration / bin の純関数テスト）
npm run build   # 本番ビルド（adapter-node → build/）
npm run start   # build/ を bin/ticktime.js 経由で起動（要 npm run build）
```

### デモ環境

実データに一切触れずに動作確認できるデモモード。

```bash
npm run demo        # サンプルデータ入りで http://localhost:5174 で起動
npm run demo:fresh  # 空DB（初回起動と同じ状態）で http://localhost:5174 で起動
```

- DB は `data/demo.db` を使用し、実データ（`data/ticktime.db`）とは完全に分離される
- **起動のたびに demo.db を削除して作り直す**（デモ中に自分で操作した内容も次回起動で消える）
- `npm run dev`（5173）と同時起動できる。ただし demo.db は共有されるため、demo は 1 プロセスのみで使うこと（strictPort により多重起動は即エラー）
- サンプルデータは直近 3 営業日 + 当日の記録を含む。D-3 / D-2 は〆済み、D-1 は未〆で残してあり、
  未〆の過去日は `/close?date=YYYY-MM-DD` を開くと〆処理を試せる
- デモ / CSV インポート等の開発スクリプトは TypeScript を Node で直接実行するため Node 24 前提
  （配布パッケージ `npx @yoshydev/ticktime` の動作要件 Node >=20 とは別）

## データベース

- SQLite（WAL モード）。初回起動時にディレクトリと DB を自動生成し、`PRAGMA user_version` 方式でマイグレーションを適用する
- **起動方法によって DB パスが異なる**:
  - `npm run dev`: `./data/ticktime.db`（gitignore 対象。`data/.gitkeep` のみコミット）
  - `npx @yoshydev/ticktime` / `npm run start`: プラットフォーム別データディレクトリ
    - Linux 等: `$XDG_DATA_HOME/ticktime/ticktime.db`（無ければ `~/.local/share/ticktime/ticktime.db`）
    - macOS: `~/Library/Application Support/ticktime/ticktime.db`
    - Windows: `%LOCALAPPDATA%\ticktime\ticktime.db`
  - いずれも `--db` / `TICKTIME_DB` で明示指定可能。`node build` 直起動は DB パス解決を通らないため正式サポート外（bin 経由が正）
- 時刻は epoch ミリ秒、業務日付は JST 基準の `YYYY-MM-DD`。業務日付の境界時刻はデフォルト 05:00（設定で変更可）
- 中身の確認: `sqlite3 <DBパス>`（開発時は `sqlite3 data/ticktime.db`。npx 利用時は上記プラットフォーム別パス。起動時のコンソールに実際のパスが表示される）
- バックアップは `ticktime.db` 単体でなく WAL の 3 点セット（`.db` / `.db-wal` / `.db-shm`）をまとめて取ること
- 別ポートで 2 プロセス起動すると同一 DB を共有する。WAL ロックとタイマー排他インデックスでデータは壊れないが UI は混乱し得るため、単一インスタンスでの利用を推奨

## better-sqlite3 のネイティブビルドについて

better-sqlite3 はネイティブアドオンをビルドするため、`npm install` 時に C++ ツールチェインが必要になる
場合がある。ビルドに失敗する場合は以下相当を用意する（Debian/Ubuntu 系 WSL2）:

```bash
sudo apt-get install -y build-essential python3
```

その後 `npm rebuild better-sqlite3` で再ビルドできる。

npx での初回起動時は prebuild バイナリを取得するためビルド不要なことが多い。Node のメジャー
バージョンを切り替えた後に `NODE_MODULE_VERSION` 不一致エラーが出る場合は、npx キャッシュ
（`~/.npm/_npx`）を削除して再実行する。

## 開発環境

- WSL2 / Node v24.11.1 を想定
