{
  description = "ticktime 開発環境（Tauriデスクトップ PoC のローカルビルド用）";

  inputs = {
    # システム設定（/etc/nixos）と同じチャンネル。実際の版は flake.lock で固定される
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          # SvelteKit / サイドカービルド（@yao-pkg/pkg）
          nodejs_24
          # better-sqlite3 のプリビルト取得失敗時のソースビルド用
          python3
          gnumake
          gcc
          # Tauri (Rust)
          rustc
          cargo
          rustfmt
          clippy
          pkg-config
          gobject-introspection
        ];

        buildInputs = with pkgs; [
          # Tauri v2 の Linux 依存
          webkitgtk_4_1
          gtk3
          libsoup_3
          openssl
          librsvg
        ];

        # WSLg 上で GTK がアイコン・スキーマを見つけられるようにする
        shellHook = ''
          export XDG_DATA_DIRS="${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}${"$"}{XDG_DATA_DIRS:+:$XDG_DATA_DIRS}"
          # WSL: 外部リンクを Windows 既定ブラウザで開けるようにする。
          # Rust の open crate は WSL では powershell.exe を最優先で試すが、
          # NixOS-WSL は Windows PATH を継承しないため devShell 側で追加する
          # （フォールバックの gio open は WSL では Operation not supported で
          # 静かに失敗する。detached 起動のためエラーログも出ない）
          # （WSL_DISTRO_NAME は非対話シェルで未設定のことがあるため、
          #   WSL 判定はディレクトリ存在のみで行う）
          if [ -d /mnt/c/Windows/System32/WindowsPowerShell/v1.0 ]; then
            export PATH="$PATH:/mnt/c/Windows/System32/WindowsPowerShell/v1.0"
          fi
        '';
      };
    };
}
