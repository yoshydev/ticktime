import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT, resolveDbPath, resolvePort, resolveServeEnv } from './lib.js';

describe('resolveDbPath', () => {
	it('--db フラグが最優先される', () => {
		expect(
			resolveDbPath({
				dbFlag: './custom.db',
				env: { TICKTIME_DB: '/env/ticktime.db' },
				platform: 'linux',
				home: '/home/u'
			})
		).toBe('./custom.db');
	});

	it('フラグが無ければ TICKTIME_DB を使う', () => {
		expect(
			resolveDbPath({
				dbFlag: undefined,
				env: { TICKTIME_DB: '/env/ticktime.db' },
				platform: 'linux',
				home: '/home/u'
			})
		).toBe('/env/ticktime.db');
	});

	it('linux: XDG_DATA_HOME があればその配下', () => {
		expect(
			resolveDbPath({ dbFlag: undefined, env: { XDG_DATA_HOME: '/xdg' }, platform: 'linux', home: '/home/u' })
		).toBe('/xdg/ticktime/ticktime.db');
	});

	it('linux: XDG_DATA_HOME が無ければ ~/.local/share 配下', () => {
		expect(resolveDbPath({ dbFlag: undefined, env: {}, platform: 'linux', home: '/home/u' })).toBe(
			'/home/u/.local/share/ticktime/ticktime.db'
		);
	});

	it('darwin: ~/Library/Application Support 配下', () => {
		expect(resolveDbPath({ dbFlag: undefined, env: {}, platform: 'darwin', home: '/Users/u' })).toBe(
			'/Users/u/Library/Application Support/ticktime/ticktime.db'
		);
	});

	it('win32: LOCALAPPDATA 配下', () => {
		expect(
			resolveDbPath({
				dbFlag: undefined,
				env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' },
				platform: 'win32',
				home: 'C:\\Users\\u'
			})
		).toBe('C:\\Users\\u\\AppData\\Local\\ticktime\\ticktime.db');
	});

	it('win32: LOCALAPPDATA が無ければホーム配下 AppData/Local にフォールバック', () => {
		expect(
			resolveDbPath({ dbFlag: undefined, env: {}, platform: 'win32', home: 'C:\\Users\\u' })
		).toBe('C:\\Users\\u\\AppData\\Local\\ticktime\\ticktime.db');
	});
});

describe('resolvePort', () => {
	it('--port フラグが PORT より優先される', () => {
		expect(resolvePort({ portFlag: '3000', env: { PORT: '4000' } })).toBe(3000);
	});

	it('フラグが無ければ PORT 環境変数を使う', () => {
		expect(resolvePort({ portFlag: undefined, env: { PORT: '4000' } })).toBe(4000);
	});

	it('どちらも無ければデフォルト 8425', () => {
		expect(resolvePort({ portFlag: undefined, env: {} })).toBe(DEFAULT_PORT);
		expect(DEFAULT_PORT).toBe(8425);
	});

	it('不正値はエラー', () => {
		expect(() => resolvePort({ portFlag: 'abc', env: {} })).toThrow(/invalid port/);
		expect(() => resolvePort({ portFlag: '0', env: {} })).toThrow(/invalid port/);
		expect(() => resolvePort({ portFlag: '65536', env: {} })).toThrow(/invalid port/);
		expect(() => resolvePort({ portFlag: '80.5', env: {} })).toThrow(/invalid port/);
		// 10進数字のみ許可（Number() が通してしまう指数・16進表記は拒否）
		expect(() => resolvePort({ portFlag: '1e3', env: {} })).toThrow(/invalid port/);
		expect(() => resolvePort({ portFlag: '0x50', env: {} })).toThrow(/invalid port/);
		expect(() => resolvePort({ portFlag: undefined, env: { PORT: 'x' } })).toThrow(/invalid port/);
	});
});

describe('resolveServeEnv', () => {
	it('デフォルト: host=127.0.0.1、origin/displayUrl は localhost:<port>', () => {
		expect(resolveServeEnv({ port: 8425, env: {} })).toEqual({
			host: '127.0.0.1',
			origin: 'http://localhost:8425',
			displayUrl: 'http://localhost:8425'
		});
	});

	it('既存 ORIGIN を尊重し、displayUrl はそこから導出される', () => {
		const result = resolveServeEnv({ port: 8425, env: { ORIGIN: 'http://127.0.0.1:9000' } });
		expect(result.origin).toBe('http://127.0.0.1:9000');
		expect(result.displayUrl).toBe('http://127.0.0.1:9000');
	});

	it('既存 HOST を尊重する', () => {
		const result = resolveServeEnv({ port: 8425, env: { HOST: '0.0.0.0' } });
		expect(result.host).toBe('0.0.0.0');
		expect(result.origin).toBe('http://localhost:8425');
	});
});
