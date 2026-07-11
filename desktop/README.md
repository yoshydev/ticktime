# ticktime desktop (PoC)

Tauri v2 でローカルサーバー（SvelteKitの自己完結バイナリ）をサイドカーとして起動し、
WebView で表示するデスクトップシェルの PoC。

## 構成

- `build-server.mjs` — SvelteKit ビルドを esbuild + @yao-pkg/pkg で単一バイナリ化（Step 1）
  - 出力: `dist/ticktime-server-x86_64-unknown-linux-gnu`
- `src-tauri/` — Tauri v2 シェル（Step 2）
  - 起動シーケンス: 空きポート確保 → サイドカー spawn（PORT/HOST/ORIGIN/TICKTIME_DB）→
    HTTP 200 をポーリング（最大10秒）→ ウィンドウ作成
  - DB は `$XDG_DATA_HOME`（無ければ `~/.local/share`）`/ticktime/poc-desktop.db`。
    開発用 `data/ticktime.db` とは分離
  - 終了時（ExitRequested/Exit）およびエラー経路でサーバープロセスを kill

## 前提

- Rust（cargo）
- Linux では webkit2gtk-4.1 ほか Tauri のシステム依存:
  `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev build-essential curl wget file libssl-dev`

## 使い方

```sh
# 1. サーバーバイナリを生成（リポジトリルートで）
npm run desktop:build-server

# 2. Tauri シェルをビルド（tauri CLI 不要。build.rs がサイドカーを target/ へ配置する）
cd desktop/src-tauri
cargo build

# 3. 実行
./target/debug/ticktime-desktop   # または cargo run
```

## PoC の範囲と製品化への残課題

本 PoC は Linux x64 のみ対象（出力名・pkg target とも固定）。検証済み: Node なし環境での
単一バイナリ動作（HTML/アセット/form action/WAL/migration）、ウィンドウ表示、正常終了・
タイムアウト経路のプロセス回収。

製品化する場合の残課題（Codex レビュー指摘含む）:

- **3OS ビルド**: tauri-action の CI マトリックス前提（macOS はクロス不可）。Windows/macOS 用の
  better-sqlite3 prebuilt `.node` 差し替え、target triple の動的導出
- **ポートレース/誤接続対策**: bind→drop→spawn の間の先取りレース、および readiness 判定が
  「`/` が 200」だけなので偶然別サービスに繋がり得る。起動時 nonce を env で渡し専用 health
  endpoint で照合する
- **サイドカーのログ回収**: 現状 `_rx` を破棄しており異常終了理由が見えない。stdout/stderr を
  （秘匿情報を出さない方針を維持しつつ）ログへ流す
- **readiness 判定の堅牢化**: `HTTP/1.1 200` 固定マッチをやめ、health endpoint の 2xx 許容に
- **localhost 露出**: サーバーは他プロセスからも到達可能。起動時生成トークンでの防御を検討
- **`fallbackToSource: true`**: 配布時はソース同梱の可否を再確認
- **DB パス**: `bin/lib.js` の `resolveDbPath()`（プラットフォーム別解決）を Rust 側へ移植
- **Linux 配布の注意**: 「Node 不要」は満たすが WebKitGTK 等のシステム依存は残る
  （Windows/macOS は WebView が OS 同梱のため問題が小さい）

## WSLg での注意

WebView が真っ白になる・クラッシュする場合は DMABUF レンダラを無効化する:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./target/debug/ticktime-desktop
```
