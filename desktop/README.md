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
  - DB パスは `bin/lib.js` の `resolveDbPath()` と同一の解決（Rust移植: `src/db_path.rs`）:
    - `TICKTIME_DB` 環境変数が最優先（debug/release 両ビルド共通。相対パスは絶対化される）
    - Windows: `%LOCALAPPDATA%`（無ければ `%USERPROFILE%\AppData\Local`）`\ticktime\<filename>`
    - macOS: `~/Library/Application Support/ticktime/<filename>`
    - Linux ほか: `$XDG_DATA_HOME`（無ければ `~/.local/share`）`/ticktime/<filename>`
  - filename は debug ビルドが `poc-desktop.db`（開発中に実DBへ触れない保護）、
    release ビルドが npx 版と同じ `ticktime.db`。
    **`cargo run --release` も実DB（ticktime.db）に接続する**点に注意
  - npx 版と同時起動した場合の注意: DB破損は WAL + タイマー排他インデックスで防がれるが、
    画面状態・タイマー表示が食い違い得る。単一インスタンスでの利用を推奨
  - 既存 `poc-desktop.db` からの移行: 自動移行はない。必要なら両プロセスを閉じた状態で
    ファイルを手動コピーする（WAL/SHM ファイルも閉じた状態でコピー）
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
サイドカーのログ回収（stdout/stderr/終了 code・signal。早期終了の即検知つき）、
DB パス解決の npx 版互換化（`bin/lib.js` `resolveDbPath()` を `src/db_path.rs` へ移植、単体テストあり）、
`fallbackToSource: true` の確認完了（バイトコード化不能ファイルをソース同梱するフラグ。
本プロジェクトは公開OSSでソース同梱に不利益なし、pkg assets（`desktop/pkg.config.json`）は
ビルド出力と better-sqlite3 系のみでシークレット・ローカル設定の混入なし → 維持を決定）。

製品化する場合の残課題（Codex レビュー指摘含む）:

- **3OS ビルド**: tauri-action の CI マトリックス前提（macOS はクロス不可）。Windows/macOS 用の
  better-sqlite3 prebuilt `.node` 差し替え、target triple の動的導出
- **localhost 露出**: サーバーは他プロセスからも到達可能。起動時生成トークンでの防御を検討
  （起動 nonce は health で誰でも取得できるため転用不可。認可用は別トークンが必要）
- **サイドカーログの redaction**: 現状はサーバー出力を無加工で転送している。サーバー側は
  秘匿情報をログに出さない方針（Jira トークンは HTTP ステータスのみ）だが、製品化時は
  防衛線として `Authorization:` 等をマスクする redaction 層をログポンプに入れる
- **Linux 配布の注意**: 「Node 不要」は満たすが WebKitGTK 等のシステム依存は残る
  （Windows/macOS は WebView が OS 同梱のため問題が小さい）

## WSLg での注意

WebView が真っ白になる・クラッシュする場合は DMABUF レンダラを無効化する:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./target/debug/ticktime-desktop
```
