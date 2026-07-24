import { describe, it, expect } from 'vitest';
import {
	AUTH_COOKIE_NAME,
	buildAuthCookieHeader,
	evaluateAuth,
	getCookieValue,
	timingSafeEqualStrings
} from './authGuard';

const TOKEN = 'a'.repeat(64);

describe('timingSafeEqualStrings', () => {
	it('一致する文字列は true', () => {
		expect(timingSafeEqualStrings('abc123', 'abc123')).toBe(true);
	});

	it('不一致の文字列は false', () => {
		expect(timingSafeEqualStrings('abc123', 'abc124')).toBe(false);
	});

	it('長さが違っても例外にならず false', () => {
		expect(timingSafeEqualStrings('abc', 'abcdef')).toBe(false);
	});

	it('空文字同士は true', () => {
		expect(timingSafeEqualStrings('', '')).toBe(true);
	});
});

describe('getCookieValue', () => {
	it('単一の cookie から値を取り出す', () => {
		expect(getCookieValue('ticktime_auth=abc', AUTH_COOKIE_NAME)).toBe('abc');
	});

	it('複数 cookie の中から名前一致で取り出す', () => {
		expect(getCookieValue('foo=1; ticktime_auth=abc; bar=2', AUTH_COOKIE_NAME)).toBe('abc');
	});

	it('前後の空白を trim する', () => {
		expect(getCookieValue('foo=1;  ticktime_auth = abc ', AUTH_COOKIE_NAME)).toBe('abc');
	});

	it('存在しない名前は undefined', () => {
		expect(getCookieValue('foo=1; bar=2', AUTH_COOKIE_NAME)).toBeUndefined();
	});

	it('ヘッダが null なら undefined', () => {
		expect(getCookieValue(null, AUTH_COOKIE_NAME)).toBeUndefined();
	});
});

describe('buildAuthCookieHeader', () => {
	it('HttpOnly な session cookie 属性で組み立てる', () => {
		expect(buildAuthCookieHeader('abc')).toBe(
			'ticktime_auth=abc; Path=/; HttpOnly; SameSite=Strict'
		);
	});
});

describe('evaluateAuth', () => {
	/** 引数の共通部分。個々のテストで上書きする。 */
	function evalWith(overrides: Partial<Parameters<typeof evaluateAuth>[0]>) {
		return evaluateAuth({
			configuredToken: TOKEN,
			method: 'GET',
			pathname: '/',
			queryTokens: [],
			cookieHeader: null,
			...overrides
		});
	}

	it('configuredToken が undefined なら常に pass（認可層無効）', () => {
		expect(evalWith({ configuredToken: undefined })).toEqual({ kind: 'pass' });
	});

	it('configuredToken が空文字でも pass（認可層無効）', () => {
		expect(evalWith({ configuredToken: '' })).toEqual({ kind: 'pass' });
	});

	it('GET /api/health は cookie なしでも pass', () => {
		expect(evalWith({ pathname: '/api/health' })).toEqual({ kind: 'pass' });
	});

	it('HEAD /api/health も pass', () => {
		expect(evalWith({ method: 'HEAD', pathname: '/api/health' })).toEqual({ kind: 'pass' });
	});

	it('OPTIONS /api/health は deny', () => {
		expect(evalWith({ method: 'OPTIONS', pathname: '/api/health' })).toEqual({ kind: 'deny' });
	});

	it('/api/health/xxx は完全一致でないため deny', () => {
		expect(evalWith({ pathname: '/api/health/xxx' })).toEqual({ kind: 'deny' });
	});

	it('/api/health/（末尾スラッシュ）は完全一致でないため deny', () => {
		expect(evalWith({ pathname: '/api/health/' })).toEqual({ kind: 'deny' });
	});

	it('/API/HEALTH（大文字）は完全一致でないため deny', () => {
		expect(evalWith({ pathname: '/API/HEALTH' })).toEqual({ kind: 'deny' });
	});

	it('GET /auth に正しい token 1つで grant（Set-Cookie 付き）', () => {
		expect(evalWith({ pathname: '/auth', queryTokens: [TOKEN] })).toEqual({
			kind: 'grant',
			setCookieHeader: `ticktime_auth=${TOKEN}; Path=/; HttpOnly; SameSite=Strict`
		});
	});

	it('POST /auth は正しい token でも deny', () => {
		expect(evalWith({ method: 'POST', pathname: '/auth', queryTokens: [TOKEN] })).toEqual({
			kind: 'deny'
		});
	});

	it('/auth/（末尾スラッシュ）はブートストラップ対象外（grant しない）', () => {
		expect(evalWith({ pathname: '/auth/', queryTokens: [TOKEN] })).toEqual({ kind: 'deny' });
	});

	it('/AUTH（大文字）はブートストラップ対象外（grant しない）', () => {
		expect(evalWith({ pathname: '/AUTH', queryTokens: [TOKEN] })).toEqual({ kind: 'deny' });
	});

	it('token クエリが重複した /auth は deny', () => {
		expect(evalWith({ pathname: '/auth', queryTokens: [TOKEN, TOKEN] })).toEqual({
			kind: 'deny'
		});
	});

	it('正・不正が混在した token 重複も deny', () => {
		expect(evalWith({ pathname: '/auth', queryTokens: [TOKEN, 'wrong'] })).toEqual({
			kind: 'deny'
		});
	});

	// 仕様: token 以外の追加クエリパラメータは grant の可否に影響しない
	// （queryTokens には token の値のみが渡り、他パラメータは判定対象外）
	it('token 以外の追加クエリ（?token=正&x=1 相当）があっても grant する', () => {
		const url = new URL(`http://localhost/auth?token=${TOKEN}&x=1`);
		expect(
			evalWith({ pathname: url.pathname, queryTokens: url.searchParams.getAll('token') })
		).toEqual({
			kind: 'grant',
			setCookieHeader: `ticktime_auth=${TOKEN}; Path=/; HttpOnly; SameSite=Strict`
		});
	});

	it('空 token の /auth は deny', () => {
		expect(evalWith({ pathname: '/auth', queryTokens: [''] })).toEqual({ kind: 'deny' });
	});

	it('257文字の token は照合せず deny', () => {
		expect(evalWith({ pathname: '/auth', queryTokens: ['x'.repeat(257)] })).toEqual({
			kind: 'deny'
		});
	});

	it('正 cookie を持っていても token 不正の /auth は deny（ブートストラップ分岐で確定）', () => {
		expect(
			evalWith({
				pathname: '/auth',
				queryTokens: ['wrong'],
				cookieHeader: `ticktime_auth=${TOKEN}`
			})
		).toEqual({ kind: 'deny' });
	});

	it('cookie が一致すれば pass', () => {
		expect(evalWith({ cookieHeader: `ticktime_auth=${TOKEN}` })).toEqual({ kind: 'pass' });
	});

	it('cookie が不一致なら deny', () => {
		expect(evalWith({ cookieHeader: 'ticktime_auth=wrong' })).toEqual({ kind: 'deny' });
	});

	it('cookie なしは deny', () => {
		expect(evalWith({ cookieHeader: null })).toEqual({ kind: 'deny' });
	});

	// 仕様: 同名 cookie が複数ある場合、getCookieValue は最初の一致を返す
	it('同名 cookie 重複時は先頭を採用する（先頭が正なら pass）', () => {
		expect(
			evalWith({ cookieHeader: `ticktime_auth=${TOKEN}; ticktime_auth=wrong` })
		).toEqual({ kind: 'pass' });
	});

	it('同名 cookie 重複時に先頭が不正なら deny（後方の正しい値は見ない）', () => {
		expect(
			evalWith({ cookieHeader: `ticktime_auth=wrong; ticktime_auth=${TOKEN}` })
		).toEqual({ kind: 'deny' });
	});

	it('巨大な cookie 値は照合せず deny', () => {
		expect(evalWith({ cookieHeader: `ticktime_auth=${'x'.repeat(300)}` })).toEqual({
			kind: 'deny'
		});
	});
});
