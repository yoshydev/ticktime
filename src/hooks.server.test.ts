import { describe, it, expect } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { handle } from './hooks.server';

/** handle は event.request しか参照しないため、Request だけ持つ疑似イベントで呼ぶ。 */
async function callHandle(request: Request): Promise<Response> {
	const event = { request } as RequestEvent;
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
});
