# ticktime desktop (PoC)

Tauri v2 でローカルサーバー（SvelteKitの自己完結バイナリ）をサイドカーとして起動し、
WebView で表示するデスクトップシェルの PoC。

## 構成

- `build-server.mjs` — SvelteKit ビルドを esbuild + @yao-pkg/pkg で単一バイナリ化（Step 1）
  - 出力: `dist/ticktime-server-<target-triple>`（例: `ticktime-server-x86_64-unknown-linux-gnu`。
    Windows は `.exe` 付き）。triple はホストOSから導出（`platform-map.mjs`）
- `src-tauri/` — Tauri v2 シェル（Step 2）
  - 起動シーケンス: 空きポート確保 → 起動毎 nonce + 認可トークン生成 → サイドカー spawn
    （PORT/HOST/ORIGIN/TICKTIME_DB/TICKTIME_STARTUP_NONCE/TICKTIME_AUTH_TOKEN）→
    `GET /api/health` が 2xx かつ `x-ticktime-nonce` ヘッダで nonce をエコーするまで
    ポーリング（最大10秒/試行）→ `/auth?token=<認可トークン>` でウィンドウ作成。
    失敗時（早期終了・nonce 不一致・タイムアウト）は新ポート + 新 nonce + 新トークンで最大3回まで再試行
  - nonce は「自分が spawn したサーバーか」の識別（ポートレース・誤接続検出）専用。
    health を GET すれば誰でも取得できるため、認可トークンとは別物（下記「localhost 認可トークン」）
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

- トリガー: `workflow_dispatch`（Actions タブから手動実行）
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

## localhost 認可トークン

デスクトップ版はサーバーを 127.0.0.1 の動的ポートで起動するため、同一マシンの
他プロセスからも到達可能。これを起動毎生成の認可トークンで防いでいる。

- Tauri シェルが起動毎に 64文字hex のトークンを生成し、env `TICKTIME_AUTH_TOKEN` で
  サイドカーへ渡す。WebView は `/auth?token=<トークン>` を開き、サーバー
  （`src/hooks.server.ts` + `src/lib/server/authGuard.ts`）がタイミングセーフ照合の上、
  HttpOnly + SameSite=Strict の session cookie を発行して `/` へ 303 リダイレクト。
  以後の全リクエストは cookie 照合（不一致は 401）
- 除外は `GET/HEAD /api/health`（完全一致）のみ。ブートストラップ `/auth` は
  GET・token パラメータちょうど1個のみ受理（既存 cookie では通さない）
- **npx 版・vite dev は env 未設定のため認可層は完全に無効**（従来どおり認証なし）
- WebView のナビゲーションは `on_navigation` でアプリ origin に制限し、
  外部リンク（Jira・報告URL等）は OS ブラウザで開く（token/cookie 文脈の持ち出し防止）
- **無認可で公開される範囲**: client assets（`/_app/*`）・`static/` 配下・prerender 済み
  ページは adapter-node が SvelteKit hooks より前に配信するため認可対象外。
  ここに機密を置かないこと
- **脅威モデルの限界**: 防御対象は「ポート到達のみの非対話プロセス」。同一ユーザー権限の
  悪意あるプロセスが env（`/proc/<pid>/environ`）・プロセスメモリ・WebView データへ
  アクセスできる場合は防げない
- cookie 消失時（WebView データクリア等）は全リクエスト 401 になる。回復はアプリ再起動
  （401 文言でも案内。PoC の許容範囲）

### Windows のインストール先と DB

- インストール先: `%LOCALAPPDATA%\TickTime Desktop`（`tauri.windows.conf.json` の
  `productName` 由来。exe 名は `mainBinaryName` で `ticktime.exe` を維持）
- DB はインストール先とは別の `%LOCALAPPDATA%\ticktime\ticktime.db`（npx 版互換のため
  変更不可・`db_path.rs`）。インストール先と DB を同居させないための分離であり、
  アンインストールしても DB は残る
- アンインストーラの「アプリデータ削除」チェックの削除対象は
  `%LOCALAPPDATA%\dev.yoshy.ticktime`（identifier ベース）で、DB には触れない
- **旧 PoC 版（`%LOCALAPPDATA%\ticktime` にインストールされた productName=ticktime 版）が
  入っている場合は、新インストーラの実行前にアンインストールすること**。NSIS 上は
  productName 変更＝別製品扱いのため、旧版は検出・更新されず「アプリと機能」に2件
  並び、ショートカットも2つ残る。旧版と新版の同時起動もしないこと（同一 DB を開く）
- WebView2 のユーザーデータ（キャッシュ・LocalStorage 等）は identifier ベースの
  `%LOCALAPPDATA%\dev.yoshy.ticktime` 配下のため、productName 変更の影響を受けず
  旧版と共通のまま（永続データは DB 側のみなのでいずれにせよ影響なし）

## PoC の範囲と製品化への残課題

検証済み: Node なし環境での単一バイナリ動作（HTML/アセット/form action/WAL/migration）、
ウィンドウ表示、正常終了・タイムアウト経路のプロセス回収、3OS の CI ビルド（上記）。

対応済み（元・残課題）: ポートレース/誤接続対策（起動 nonce + `/api/health` 照合、最大3回再試行）、
readiness 判定の堅牢化（`HTTP/1.x` 2xx + nonce ヘッダ照合。`http_probe.rs` に単体テストあり）、
サイドカーのログ回収（stdout/stderr/終了 code・signal。早期終了の即検知つき）、
DB パス解決の npx 版互換化（`bin/lib.js` `resolveDbPath()` を `src/db_path.rs` へ移植、単体テストあり）、
localhost 露出の認可トークン（上記「localhost 認可トークン」。smoke テストで契約検証）、
`fallbackToSource: true` の確認完了（バイトコード化不能ファイルをソース同梱するフラグ。
本プロジェクトは公開OSSでソース同梱に不利益なし、pkg assets（`desktop/pkg.config.json`）は
ビルド出力と better-sqlite3 系のみでシークレット・ローカル設定の混入なし → 維持を決定）、
3OS ビルド（GitHub Actions マトリックス + target triple 動的導出 + アイコン一式 +
サイドカースモークテスト。各 OS ランナーでのネイティブビルド方式）。

製品化する場合の残課題（Codex レビュー指摘含む）:

- **サイドカーログの redaction の拡充**: `token=` クエリのマスクはログポンプに実装済み。
  サーバー側は秘匿情報をログに出さない方針（Jira トークンは HTTP ステータスのみ）だが、
  製品化時は防衛線として `Authorization:` ヘッダ等のマスクも追加する
- **cookie 消失時の再ブートストラップ**: 現状はアプリ再起動が必要。Rust 側が保持する
  トークンで自動再認可する仕組みは未実装（PoC では許容）
- **Linux 配布の注意**: 「Node 不要」は満たすが WebKitGTK 等のシステム依存は残る
  （Windows/macOS は WebView が OS 同梱のため問題が小さい）
- **コード署名 / notarization**: Windows・macOS とも未署名（macOS は Gatekeeper 回避手順で
  対応、Windows は SmartScreen 警告が出る）。広く配布するなら署名が必要。
  **スマートアプリコントロール（SAC）有効の Windows 11 では未署名インストーラは
  MotW の有無によらずブロックされ、回避ボタンも出ない**（SAC 無効化は Windows
  再インストールなしに再有効化できないため推奨しない）。SAC 環境での動作確認は署名対応後

## WSLg での注意

WebView が真っ白になる・クラッシュする場合は DMABUF レンダラを無効化する:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./target/debug/ticktime-desktop
```

起動時に `libEGL warning` / `MESA: error: ZINK: failed to choose pdev` が出ることがあるが、
ソフトウェアレンダリングへのフォールバックであり描画・動作に支障はない（NixOS WSL2 で確認済み）。
