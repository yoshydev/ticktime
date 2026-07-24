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
  - Debian/Ubuntu 系:
    `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev build-essential curl wget file libssl-dev`
  - NixOS: リポジトリ直下の `flake.nix` の devShell を使う（下記）

### NixOS でのセットアップ

ビルドツール一式はリポジトリ直下の flake が提供する。`nix develop` で入るか、
direnv 利用なら `direnv allow` で cd 時に自動有効化される
（`.envrc` の `use flake` には NixOS 設定で `programs.direnv.enable` と
`programs.direnv.nix-direnv.enable` の有効化が必要）。

加えて **nix-ld の有効化が必須**（システム設定・要 rebuild）:

```nix
programs.nix-ld = {
  enable = true;
  libraries = with pkgs; [ stdenv.cc.cc.lib ]; # libstdc++（プリビルト better-sqlite3 等が要求）
};
```

理由: `@yao-pkg/pkg` はバイトコード生成時にプリビルト Node（`~/.pkg-cache`）を、
Tauri シェルは生成済みサイドカーを、いずれも汎用 Linux 向け ELF
（interpreter `/lib64/ld-linux-x86-64.so.2`）として実行するため。
pkg は子プロセスを最小 env で spawn するので `NIX_LD` 環境変数では届かず、
nix-ld の既定フォールバック（`/run/current-system/sw/share/nix-ld/lib`）に依存する。
nix-ld が無効（または stub-ld のまま）だと、pkg ビルドは **exit 0 のまま壊れた
バイナリを出力する**（`write EPIPE` 警告が大量に出る）点に注意。

## 使い方

```sh
# 1. サーバーバイナリを生成（リポジトリルートで）
npm run desktop:build-server

# 2. Tauri シェルをビルド（tauri CLI 不要。build.rs がサイドカーを target/ へ配置する）
#    ※ build.rs が bundle.externalBin としてサイドカーを解決するため、
#      cargo test / cargo build とも手順1の後でないと失敗する
#    ※ Rust側の単体テスト（http_probe）は `npm run test` に含まれないため cargo test で実行する
cd desktop/src-tauri
cargo test
cargo build

# 3. 実行
./target/debug/ticktime-desktop   # または cargo run
```

### サイドカー単体スモークテスト

GUI なしでサイドカーの起動契約（health + nonce エコー）だけを検証できる（CI でも使用）:

```sh
node desktop/scripts/smoke-sidecar.mjs
```

## 3OS ビルド（GitHub Actions）

`.github/workflows/desktop-build.yml` が Linux（ubuntu-24.04）/ Windows（windows-2025）/
macOS（macos-15, arm64）のマトリックスでバンドルを生成し、Artifacts にアップロードする。

- トリガー: `workflow_dispatch`（Actions タブから手動実行）。PoC 期間中は
  `poc/tauri-desktop` への push でも実行される（main マージ時に push トリガーは削除）
- 成果物: Linux = AppImage + deb、Windows = NSIS インストーラ（`*-setup.exe`）、
  macOS = dmg。リポジトリの Actions → 該当 run → Artifacts からダウンロード
- 各 OS ランナー上でネイティブビルドする（**クロスビルド非対応** — pkg の Node
  プレビルトも better-sqlite3 の `.node` もホスト OS 依存のため）。
  `build-server.mjs` はホストの `process.platform`-`process.arch` から
  pkg target / target triple を導出する（Windows はサイドカーに `.exe` を明示付与）
- バージョンは `package.json` が単一ソース（`tauri.conf.json` の `version` は
  `"../../package.json"` 参照。`Cargo.toml` の version は crate 用でバンドルには使われない）
- macOS は arm64（Apple Silicon）のみ。Intel Mac が必要になったら matrix に
  `macos-13` を追加する（プラットフォームマップには x64 エントリ定義済み）

### macOS で開く（Gatekeeper）

未署名 dmg のため、初回はダウンロード後に quarantine 属性の除去が必要:

```sh
xattr -dr com.apple.quarantine /Applications/ticktime.app
```

## PoC の範囲と製品化への残課題

検証済み: Node なし環境での単一バイナリ動作（HTML/アセット/form action/WAL/migration）、
ウィンドウ表示、正常終了・タイムアウト経路のプロセス回収、3OS の CI ビルド（上記）。

対応済み（元・残課題）: ポートレース/誤接続対策（起動 nonce + `/api/health` 照合、最大3回再試行）、
readiness 判定の堅牢化（`HTTP/1.x` 2xx + nonce ヘッダ照合。`http_probe.rs` に単体テストあり）、
サイドカーのログ回収（stdout/stderr/終了 code・signal。早期終了の即検知つき）、
DB パス解決の npx 版互換化（`bin/lib.js` `resolveDbPath()` を `src/db_path.rs` へ移植、単体テストあり）、
`fallbackToSource: true` の確認完了（バイトコード化不能ファイルをソース同梱するフラグ。
本プロジェクトは公開OSSでソース同梱に不利益なし、pkg assets（`desktop/pkg.config.json`）は
ビルド出力と better-sqlite3 系のみでシークレット・ローカル設定の混入なし → 維持を決定）、
3OS ビルド（GitHub Actions マトリックス + target triple 動的導出 + アイコン一式 +
サイドカースモークテスト。各 OS ランナーでのネイティブビルド方式）。

製品化する場合の残課題（Codex レビュー指摘含む）:

- **localhost 露出**: サーバーは他プロセスからも到達可能。起動時生成トークンでの防御を検討
  （起動 nonce は health で誰でも取得できるため転用不可。認可用は別トークンが必要）
- **サイドカーログの redaction**: 現状はサーバー出力を無加工で転送している。サーバー側は
  秘匿情報をログに出さない方針（Jira トークンは HTTP ステータスのみ）だが、製品化時は
  防衛線として `Authorization:` 等をマスクする redaction 層をログポンプに入れる
- **Linux 配布の注意**: 「Node 不要」は満たすが WebKitGTK 等のシステム依存は残る
  （Windows/macOS は WebView が OS 同梱のため問題が小さい）
- **コード署名 / notarization**: Windows・macOS とも未署名（macOS は Gatekeeper 回避手順で
  対応、Windows は SmartScreen 警告が出る）。広く配布するなら署名が必要

## WSLg での注意

WebView が真っ白になる・クラッシュする場合は DMABUF レンダラを無効化する:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./target/debug/ticktime-desktop
```

起動時に `libEGL warning` / `MESA: error: ZINK: failed to choose pdev` が出ることがあるが、
ソフトウェアレンダリングへのフォールバックであり描画・動作に支障はない（NixOS WSL2 で確認済み）。
