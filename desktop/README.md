# ticktime desktop (PoC)

Tauri v2 でローカルサーバー（SvelteKitの自己完結バイナリ）をサイドカーとして起動し、
WebView で表示するデスクトップシェルの PoC。

## 構成

- `build-server.mjs` — SvelteKit ビルドを esbuild + @yao-pkg/pkg で単一バイナリ化（Step 1）
  - 出力: `dist/ticktime-server-x86_64-unknown-linux-gnu`
- `src-tauri/` — Tauri v2 シェル（Step 2）
  - 起動シーケンス: 空きポート確保 → 起動毎 nonce 生成 → サイドカー spawn
    （PORT/HOST/ORIGIN/TICKTIME_DB/TICKTIME_STARTUP_NONCE）→
    `GET /api/health` が 2xx かつ `x-ticktime-nonce` ヘッダで nonce をエコーするまで
    ポーリング（最大10秒/試行）→ ウィンドウ作成。
    失敗時（早期終了・nonce 不一致・タイムアウト）は新ポート + 新 nonce で最大3回まで再試行
  - nonce は「自分が spawn したサーバーか」の識別（ポートレース・誤接続検出）専用。
    health を GET すれば誰でも取得できるため、localhost 露出対策の認可トークンには転用できない
  - サイドカーの stdout/stderr は `[ticktime-server]` プレフィックスで回収
    （1行4096バイト超は切り詰め）。異常終了は code/signal をログし readiness 待ちを即打ち切る
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
#    ※ Rust側の単体テスト（http_probe）は `npm run test` に含まれないため cargo test で実行する
cd desktop/src-tauri
cargo test
cargo build

# 3. 実行
./target/debug/ticktime-desktop   # または cargo run
```

## PoC の範囲と製品化への残課題

本 PoC は Linux x64 のみ対象（出力名・pkg target とも固定）。検証済み: Node なし環境での
単一バイナリ動作（HTML/アセット/form action/WAL/migration）、ウィンドウ表示、正常終了・
タイムアウト経路のプロセス回収。

対応済み（元・残課題）: ポートレース/誤接続対策（起動 nonce + `/api/health` 照合、最大3回再試行）、
readiness 判定の堅牢化（`HTTP/1.x` 2xx + nonce ヘッダ照合。`http_probe.rs` に単体テストあり）、
サイドカーのログ回収（stdout/stderr/終了 code・signal。早期終了の即検知つき）。

製品化する場合の残課題（Codex レビュー指摘含む）:

- **3OS ビルド**: tauri-action の CI マトリックス前提（macOS はクロス不可）。Windows/macOS 用の
  better-sqlite3 prebuilt `.node` 差し替え、target triple の動的導出
- **localhost 露出**: サーバーは他プロセスからも到達可能。起動時生成トークンでの防御を検討
  （起動 nonce は health で誰でも取得できるため転用不可。認可用は別トークンが必要）
- **サイドカーログの redaction**: 現状はサーバー出力を無加工で転送している。サーバー側は
  秘匿情報をログに出さない方針（Jira トークンは HTTP ステータスのみ）だが、製品化時は
  防衛線として `Authorization:` 等をマスクする redaction 層をログポンプに入れる
- **`fallbackToSource: true`**: 配布時はソース同梱の可否を再確認
- **DB パス**: `bin/lib.js` の `resolveDbPath()`（プラットフォーム別解決）を Rust 側へ移植
- **Linux 配布の注意**: 「Node 不要」は満たすが WebKitGTK 等のシステム依存は残る
  （Windows/macOS は WebView が OS 同梱のため問題が小さい）

## WSLg での注意

WebView が真っ白になる・クラッシュする場合は DMABUF レンダラを無効化する:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./target/debug/ticktime-desktop
```
