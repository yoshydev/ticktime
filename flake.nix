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
        '';
      };
    };
}
