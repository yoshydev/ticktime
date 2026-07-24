import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildHealthHeaders } from '$lib/server/health';

/**
 * GET /api/health
 * 常に 200 { status: 'ok' }。TICKTIME_STARTUP_NONCE が設定されていれば
 * x-ticktime-nonce ヘッダでエコーする（デスクトップシェルのサーバー識別用）。
 */
export const GET: RequestHandler = async () => {
	// リクエスト時に読む（モジュールトップで読むと起動順に依存するため）
	const nonce = process.env.TICKTIME_STARTUP_NONCE;
	return json({ status: 'ok' }, { headers: buildHealthHeaders(nonce) });
};
