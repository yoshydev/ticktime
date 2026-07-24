import { describe, it, expect, vi, afterEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { handle } from './hooks.server';

/** handle は event.request / event.url しか参照しないため、その2つだけ持つ疑似イベントで呼ぶ。 */
async function callHandle(request: Request): Promise<Response> {
	const event = { request, url: new URL(request.url) } as RequestEvent;
	return await handle({ event, resolve: async () => new Response('resolved') });
}

function formPost(url: string, headers: Record<string, string>): Request {
	return new Request(url, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
		body: 'ticketId=1'
	});
}

describe('hooks.server handle（CSRF検証の統合）', () => {
	it('同一ループバックオリジンのフォームPOSTは resolve に進む', async () => {
		for (const host of ['localhost:8425', '127.0.0.1:8425', '[::1]:8425']) {
			const res = await callHandle(
				formPost(`http://${host}/?/start`, { origin: `http://${host}`, host })
			);
			expect(await res.text()).toBe('resolved');
		}
	});

	it('クロスオリジンのフォームPOSTは text/plain の 403', async () => {
		const res = await callHandle(
			formPost('http://localhost:8425/?/start', {
				origin: 'http://evil.example',
				host: 'localhost:8425'
			})
		);
		expect(res.status).toBe(403);
		expect(res.headers.get('content-type')).toContain('text/plain');
	});

	it('use:enhance（Accept: application/json）のクロスオリジンには ActionResult 形式の 403 JSON', async () => {
		const res = await callHandle(
			formPost('http://localhost:8425/?/start', {
				origin: 'http://evil.example',
				host: 'localhost:8425',
				accept: 'application/json'
			})
		);
		expect(res.status).toBe(403);
		expect(res.headers.get('content-type')).toContain('application/json');
		const body = await res.json();
		expect(body.type).toBe('error');
		expect(typeof body.error.message).toBe('string');
	});

	it('GET は検証されず resolve に進む', async () => {
		const res = await callHandle(new Request('http://localhost:8425/'));
		expect(await res.text()).toBe('resolved');
	});

	it('env 未設定なら /auth?token=xxx も認可層をスキップして resolve に進む', async () => {
		// TICKTIME_AUTH_TOKEN 未設定（npx版・vite dev）では認可層は無効で、
		// GET は CSRF 検証対象外のためそのまま resolve される
		const res = await callHandle(new Request('http://localhost:8425/auth?token=xxx'));
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('resolved');
		expect(res.headers.get('set-cookie')).toBeNull();
	});
});

describe('hooks.server handle（認可層: TICKTIME_AUTH_TOKEN 設定時）', () => {
	const TOKEN = 'f'.repeat(64);

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	function stubToken() {
		vi.stubEnv('TICKTIME_AUTH_TOKEN', TOKEN);
	}

	it('cookie なしの GET / は text/plain の 401', async () => {
		stubToken();
		const res = await callHandle(new Request('http://localhost:8425/'));
		expect(res.status).toBe(401);
		expect(res.headers.get('content-type')).toContain('text/plain');
	});

	it('Accept: application/json の POST には ActionResult 形式の 401 JSON', async () => {
		stubToken();
		const res = await callHandle(
			formPost('http://localhost:8425/?/start', {
				origin: 'http://localhost:8425',
				host: 'localhost:8425',
				accept: 'application/json'
			})
		);
		expect(res.status).toBe(401);
		expect(res.headers.get('content-type')).toContain('application/json');
		const body = await res.json();
		expect(body.type).toBe('error');
		expect(typeof body.error.message).toBe('string');
	});

	it('GET /auth?token=正 は 303 で cookie を配りトップへリダイレクト', async () => {
		stubToken();
		const res = await callHandle(new Request(`http://localhost:8425/auth?token=${TOKEN}`));
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toBe('/');
		const setCookie = res.headers.get('set-cookie');
		expect(setCookie).toContain('ticktime_auth=');
		expect(setCookie).toContain('HttpOnly');
		expect(res.headers.get('referrer-policy')).toBe('no-referrer');
	});

	it('GET /auth?token=不正 は 401 で set-cookie なし', async () => {
		stubToken();
		const res = await callHandle(new Request('http://localhost:8425/auth?token=wrong'));
		expect(res.status).toBe(401);
		expect(res.headers.get('set-cookie')).toBeNull();
	});

	it('パーセントエンコードした /%61uth は grant されない（pathname はデコードされない）', async () => {
		stubToken();
		// URL.pathname はパーセントエンコードを保持するため '/auth' と一致せず、
		// ブートストラップ分岐に入らない（cookie なしなので 401）
		const res = await callHandle(new Request(`http://localhost:8425/%61uth?token=${TOKEN}`));
		expect(res.status).toBe(401);
		expect(res.headers.get('set-cookie')).toBeNull();
	});

	it('TICKTIME_AUTH_TOKEN が空文字なら認可層は無効（cookie なし GET / が resolve される）', async () => {
		vi.stubEnv('TICKTIME_AUTH_TOKEN', '');
		const res = await callHandle(new Request('http://localhost:8425/'));
		expect(await res.text()).toBe('resolved');
	});

	it('正 cookie 付きの GET / は resolve に進む', async () => {
		stubToken();
		const res = await callHandle(
			new Request('http://localhost:8425/', {
				headers: { cookie: `ticktime_auth=${TOKEN}` }
			})
		);
		expect(await res.text()).toBe('resolved');
	});

	it('GET /api/health は cookie なしでも resolve に進む', async () => {
		stubToken();
		const res = await callHandle(new Request('http://localhost:8425/api/health'));
		expect(await res.text()).toBe('resolved');
	});

	it('正 cookie でもクロスオリジンのフォームPOSTは 403（認可→CSRFの層順序）', async () => {
		stubToken();
		const res = await callHandle(
			formPost('http://localhost:8425/?/start', {
				origin: 'http://evil.example',
				host: 'localhost:8425',
				cookie: `ticktime_auth=${TOKEN}`
			})
		);
		expect(res.status).toBe(403);
	});
});
