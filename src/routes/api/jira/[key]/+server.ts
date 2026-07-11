import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchIssueTitle, JiraError } from '$lib/server/jira';

/** Jira チケットキーの許容形式（例: TICKET-123）。 */
const KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;

/**
 * GET /api/jira/<KEY>
 * 成功: { title }。設定なし: { error: 'not_configured' } (503)。取得失敗: { error: 'fetch_failed' } (502)。
 * レスポンスには認証情報を一切含めない。
 */
export const GET: RequestHandler = async ({ params }) => {
	const key = params.key ?? '';
	if (!KEY_RE.test(key)) {
		return json({ error: 'invalid_key' }, { status: 400 });
	}
	try {
		const title = await fetchIssueTitle(key);
		return json({ title });
	} catch (e) {
		if (e instanceof JiraError && e.code === 'not_configured') {
			return json({ error: 'not_configured' }, { status: 503 });
		}
		return json({ error: 'fetch_failed' }, { status: 502 });
	}
};
