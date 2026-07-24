// DBパス解決の純関数。bin/lib.js の resolveDbPath() と互換のセマンティクスを持つ。
// env/platform/home はすべて引数で受け、副作用を持たない。
//
// 返り値を String にしている理由: Windows パス（`\` 区切り）の結合を Linux 上の
// 単体テストで再現するため。PathBuf::join は実行OSの区切り文字に依存するので使わず、
// プラットフォーム別の区切り文字で自前結合する。

/// 対象プラットフォーム。linux ほか未知のOSは Linux 扱い（JS版の「linux ほか」と同じ）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
	Windows,
	MacOs,
	Linux,
}

/// DBパスを解決する。優先順位: TICKTIME_DB 環境変数 > プラットフォーム別デフォルト。
/// 返り値は相対パスの可能性があるため、呼び出し側で絶対化して使うこと
/// （npx版 bin/ticktime.js が path.resolve() するのと同じ扱い）。
///
/// - `ticktime_db` / `localappdata` / `xdg_data_home`: Some("") は未設定扱い
///   （JSの falsy 判定 `env.X ||` と互換にするため）
/// - `filename`: "ticktime.db"（release）または "poc-desktop.db"（debug）
pub fn resolve_db_path(
	ticktime_db: Option<&str>,
	localappdata: Option<&str>,
	xdg_data_home: Option<&str>,
	home: &str,
	platform: Platform,
	filename: &str,
) -> String {
	// Some("") を None に潰す（JSの falsy 互換）
	fn non_empty(v: Option<&str>) -> Option<&str> {
		v.filter(|s| !s.is_empty())
	}

	if let Some(db) = non_empty(ticktime_db) {
		return db.to_owned();
	}

	// base 末尾の区切り文字を落とす（JS版 path.join が正規化するのに合わせ、
	// `XDG_DATA_HOME=/xdg/` → `/xdg//ticktime/...` のような重複を防ぐ）
	fn trim_sep<'a>(base: &'a str, sep: char) -> &'a str {
		base.trim_end_matches(sep)
	}

	match platform {
		Platform::Windows => {
			// %LOCALAPPDATA% が無ければ %USERPROFILE% 配下の標準位置にフォールバック
			let base = match non_empty(localappdata) {
				Some(base) => trim_sep(base, '\\').to_owned(),
				None => format!("{}\\AppData\\Local", trim_sep(home, '\\')),
			};
			format!("{base}\\ticktime\\{filename}")
		}
		Platform::MacOs => {
			format!("{}/Library/Application Support/ticktime/{filename}", trim_sep(home, '/'))
		}
		Platform::Linux => {
			// XDG Base Directory 準拠。JS版と同じく絶対パス判定はしない
			let base = match non_empty(xdg_data_home) {
				Some(base) => trim_sep(base, '/').to_owned(),
				None => format!("{}/.local/share", trim_sep(home, '/')),
			};
			format!("{base}/ticktime/{filename}")
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	// bin/lib.test.js の resolveDbPath ケースをミラーしたもの
	// （--db フラグはデスクトップ版に存在しないため対象外）

	#[test]
	fn ticktime_db_is_top_priority() {
		// TICKTIME_DB があれば他の値に関わらずそのまま返す
		assert_eq!(
			resolve_db_path(
				Some("/env/ticktime.db"),
				Some("C:\\Users\\u\\AppData\\Local"),
				Some("/xdg"),
				"/home/u",
				Platform::Linux,
				"ticktime.db",
			),
			"/env/ticktime.db"
		);
	}

	#[test]
	fn empty_string_is_treated_as_unset() {
		// Some("") は未設定扱い（JSの falsy 互換）
		assert_eq!(
			resolve_db_path(Some(""), None, Some(""), "/home/u", Platform::Linux, "ticktime.db"),
			"/home/u/.local/share/ticktime/ticktime.db"
		);
	}

	#[test]
	fn linux_uses_xdg_data_home_when_set() {
		assert_eq!(
			resolve_db_path(None, None, Some("/xdg"), "/home/u", Platform::Linux, "ticktime.db"),
			"/xdg/ticktime/ticktime.db"
		);
	}

	#[test]
	fn linux_falls_back_to_local_share() {
		assert_eq!(
			resolve_db_path(None, None, None, "/home/u", Platform::Linux, "ticktime.db"),
			"/home/u/.local/share/ticktime/ticktime.db"
		);
	}

	#[test]
	fn macos_uses_application_support() {
		assert_eq!(
			resolve_db_path(None, None, None, "/Users/u", Platform::MacOs, "ticktime.db"),
			"/Users/u/Library/Application Support/ticktime/ticktime.db"
		);
	}

	#[test]
	fn windows_uses_localappdata_when_set() {
		assert_eq!(
			resolve_db_path(
				None,
				Some("C:\\Users\\u\\AppData\\Local"),
				None,
				"C:\\Users\\u",
				Platform::Windows,
				"ticktime.db",
			),
			"C:\\Users\\u\\AppData\\Local\\ticktime\\ticktime.db"
		);
	}

	#[test]
	fn windows_falls_back_to_home_appdata_local() {
		assert_eq!(
			resolve_db_path(None, None, None, "C:\\Users\\u", Platform::Windows, "ticktime.db"),
			"C:\\Users\\u\\AppData\\Local\\ticktime\\ticktime.db"
		);
	}

	#[test]
	fn trailing_separator_in_base_is_normalized() {
		// JS版 path.join の正規化に合わせ、末尾区切り文字の重複を防ぐ
		assert_eq!(
			resolve_db_path(None, None, Some("/xdg/"), "/home/u", Platform::Linux, "ticktime.db"),
			"/xdg/ticktime/ticktime.db"
		);
		assert_eq!(
			resolve_db_path(None, None, None, "/home/u/", Platform::Linux, "ticktime.db"),
			"/home/u/.local/share/ticktime/ticktime.db"
		);
		assert_eq!(
			resolve_db_path(
				None,
				Some("C:\\Users\\u\\AppData\\Local\\"),
				None,
				"C:\\Users\\u",
				Platform::Windows,
				"ticktime.db",
			),
			"C:\\Users\\u\\AppData\\Local\\ticktime\\ticktime.db"
		);
	}

	#[test]
	fn debug_filename_resolves_on_all_platforms() {
		// debugビルド用ファイル名（poc-desktop.db）でも同じ規則で解決される
		assert_eq!(
			resolve_db_path(None, None, None, "/home/u", Platform::Linux, "poc-desktop.db"),
			"/home/u/.local/share/ticktime/poc-desktop.db"
		);
		assert_eq!(
			resolve_db_path(None, None, None, "/Users/u", Platform::MacOs, "poc-desktop.db"),
			"/Users/u/Library/Application Support/ticktime/poc-desktop.db"
		);
		assert_eq!(
			resolve_db_path(None, None, None, "C:\\Users\\u", Platform::Windows, "poc-desktop.db"),
			"C:\\Users\\u\\AppData\\Local\\ticktime\\poc-desktop.db"
		);
	}
}
