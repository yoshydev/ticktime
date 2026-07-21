// HTTP readiness プローブ用の簡易パーサ
//
// 外部HTTPクレートを増やさず、std の Read だけでレスポンスヘッダ部を読み取り、
// ステータスコードと nonce エコーヘッダ（x-ticktime-nonce）を照合する。
// ポートレース（別サービスが同ポートで応答するケース）を NonceMismatch として
// 区別できるようにするのが目的。

use std::io::Read;

/// ヘッダ部として読み込む上限。これを超えて終端（\r\n\r\n）が現れなければ諦める。
const MAX_HEAD_BYTES: usize = 16 * 1024;

/// レスポンスのヘッダ部（ステータスライン + ヘッダ行）を読み取る。
///
/// - `\r\n\r\n`（ヘッダ終端）が現れるまで小バッファで read を繰り返す
/// - 終端到達: `Ok(Some(head))`（lossy UTF-8。終端の空行は含まない）
/// - EOF や 16KB 上限到達で終端未達: `Ok(None)`
/// - read エラー（read_timeout 含む）はそのまま `Err`
pub fn read_response_head(r: &mut impl Read) -> std::io::Result<Option<String>> {
	let mut buf: Vec<u8> = Vec::new();
	let mut chunk = [0u8; 512];
	loop {
		let n = r.read(&mut chunk)?;
		if n == 0 {
			// EOF: 終端未達のまま切断された
			return Ok(None);
		}
		buf.extend_from_slice(&chunk[..n]);
		if let Some(pos) = find_head_end(&buf) {
			return Ok(Some(String::from_utf8_lossy(&buf[..pos]).into_owned()));
		}
		if buf.len() >= MAX_HEAD_BYTES {
			// ヘッダが異常に長い（HTTPでない何かの可能性）
			return Ok(None);
		}
	}
}

/// `\r\n\r\n` の開始位置を探す
fn find_head_end(buf: &[u8]) -> Option<usize> {
	buf.windows(4).position(|w| w == b"\r\n\r\n")
}

/// ステータスラインからステータスコードを取り出す。
/// `HTTP/1.0` または `HTTP/1.1` で始まらない・コードが u16 でない場合は None。
pub fn parse_status_code(head: &str) -> Option<u16> {
	let line = head.lines().next()?;
	let mut tokens = line.split_ascii_whitespace();
	let version = tokens.next()?;
	if version != "HTTP/1.0" && version != "HTTP/1.1" {
		return None;
	}
	tokens.next()?.parse().ok()
}

/// ヘッダ部から指定名のヘッダ値を探す（名前は大文字小文字非区別、値は trim）。
/// 最初に一致した行の値を返す。
pub fn find_header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
	// 先頭行はステータスラインなので飛ばす
	for line in head.lines().skip(1) {
		if let Some((key, value)) = line.split_once(':') {
			if key.trim().eq_ignore_ascii_case(name) {
				return Some(value.trim());
			}
		}
	}
	None
}

/// readiness 判定の結果
#[derive(Debug, PartialEq, Eq)]
pub enum ProbeResult {
	/// 2xx かつ nonce 一致 → 自分が起動したサーバーが ready
	Ready,
	/// 完全なHTTP応答だが nonce 欠落 or 不一致 → 別サービスの応答とみなす
	NonceMismatch,
	/// ステータスラインがパース不能 → まだ ready でない（再試行対象）
	NotReady,
}

/// ヘッダ部を検査して readiness を判定する。
///
/// - 2xx かつ `x-ticktime-nonce` が expected_nonce と完全一致 → `Ready`
/// - パースできる応答だが nonce ヘッダ欠落 or 不一致 → `NonceMismatch`
/// - nonce は一致するが 2xx でない → `NotReady`（自サーバーの起動途中とみなす）
/// - ステータスラインがパース不能 → `NotReady`
pub fn is_ready_response(head: &str, expected_nonce: &str) -> ProbeResult {
	let Some(code) = parse_status_code(head) else {
		return ProbeResult::NotReady;
	};
	match find_header(head, "x-ticktime-nonce") {
		Some(value) if value == expected_nonce => {
			if (200..300).contains(&code) {
				ProbeResult::Ready
			} else {
				ProbeResult::NotReady
			}
		}
		_ => ProbeResult::NonceMismatch,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	const NONCE: &str = "abc-123";

	fn head_of(raw: &[u8]) -> Option<String> {
		let mut r: &[u8] = raw;
		read_response_head(&mut r).expect("read error")
	}

	#[test]
	fn read_head_terminator_found() {
		let head = head_of(b"HTTP/1.1 200 OK\r\nx-ticktime-nonce: abc-123\r\n\r\nbody...").unwrap();
		assert_eq!(head, "HTTP/1.1 200 OK\r\nx-ticktime-nonce: abc-123");
	}

	#[test]
	fn read_head_eof_before_terminator_is_none() {
		// 途中切断: 終端の \r\n\r\n が来る前に EOF
		assert_eq!(head_of(b"HTTP/1.1 200 OK\r\nx-tickt"), None);
	}

	#[test]
	fn read_head_over_16kb_without_terminator_is_none() {
		let raw = vec![b'A'; MAX_HEAD_BYTES + 100];
		assert_eq!(head_of(&raw), None);
	}

	#[test]
	fn ready_when_200_and_nonce_matches() {
		let head = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nx-ticktime-nonce: abc-123";
		assert_eq!(is_ready_response(head, NONCE), ProbeResult::Ready);
	}

	#[test]
	fn ready_on_other_2xx_codes() {
		for code in ["200", "201", "204", "299"] {
			let head = format!("HTTP/1.1 {code} X\r\nx-ticktime-nonce: abc-123");
			assert_eq!(is_ready_response(&head, NONCE), ProbeResult::Ready, "code={code}");
		}
	}

	#[test]
	fn http10_status_line_is_accepted() {
		let head = "HTTP/1.0 200 OK\r\nx-ticktime-nonce: abc-123";
		assert_eq!(is_ready_response(head, NONCE), ProbeResult::Ready);
	}

	#[test]
	fn mismatch_when_404_without_nonce() {
		// 別サービス（nonce を知らない）が同ポートで応答したケース
		let head = "HTTP/1.1 404 Not Found\r\nContent-Type: text/html";
		assert_eq!(is_ready_response(head, NONCE), ProbeResult::NonceMismatch);
	}

	#[test]
	fn mismatch_when_nonce_differs() {
		let head = "HTTP/1.1 200 OK\r\nx-ticktime-nonce: other-nonce";
		assert_eq!(is_ready_response(head, NONCE), ProbeResult::NonceMismatch);
	}

	#[test]
	fn mismatch_when_nonce_header_missing() {
		let head = "HTTP/1.1 200 OK\r\nContent-Type: text/html";
		assert_eq!(is_ready_response(head, NONCE), ProbeResult::NonceMismatch);
	}

	#[test]
	fn header_name_is_case_insensitive() {
		let head = "HTTP/1.1 200 OK\r\nX-TickTime-NONCE: abc-123";
		assert_eq!(is_ready_response(head, NONCE), ProbeResult::Ready);
	}

	#[test]
	fn header_value_is_trimmed() {
		let head = "HTTP/1.1 200 OK\r\nx-ticktime-nonce:   abc-123  ";
		assert_eq!(find_header(head, "x-ticktime-nonce"), Some("abc-123"));
		assert_eq!(is_ready_response(head, NONCE), ProbeResult::Ready);
	}

	#[test]
	fn first_matching_header_wins() {
		let head = "HTTP/1.1 200 OK\r\nx-ticktime-nonce: abc-123\r\nx-ticktime-nonce: zzz";
		assert_eq!(find_header(head, "x-ticktime-nonce"), Some("abc-123"));
	}

	#[test]
	fn not_ready_when_status_line_is_garbage() {
		assert_eq!(is_ready_response("SSH-2.0-OpenSSH_9.6", NONCE), ProbeResult::NotReady);
		assert_eq!(is_ready_response("HTTP/2 200", NONCE), ProbeResult::NotReady);
		assert_eq!(is_ready_response("HTTP/1.1 abc OK", NONCE), ProbeResult::NotReady);
		assert_eq!(is_ready_response("", NONCE), ProbeResult::NotReady);
	}

	#[test]
	fn not_ready_when_nonce_matches_but_not_2xx() {
		// 自サーバーの応答（nonce一致）だがエラー系 → 再試行させる
		let head = "HTTP/1.1 503 Service Unavailable\r\nx-ticktime-nonce: abc-123";
		assert_eq!(is_ready_response(head, NONCE), ProbeResult::NotReady);
	}

	#[test]
	fn parse_status_code_basics() {
		assert_eq!(parse_status_code("HTTP/1.1 200 OK"), Some(200));
		assert_eq!(parse_status_code("HTTP/1.0 404 Not Found"), Some(404));
		assert_eq!(parse_status_code("HTTP/1.1 99999 X"), None);
		assert_eq!(parse_status_code("HTTP/1.1"), None);
	}
}
