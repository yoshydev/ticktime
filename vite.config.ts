import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	server: {
		// 多重起動防止: 5173が使用中なら別ポートへ逃げず即エラー終了させる
		// （複数のvite devが .svelte-kit/generated を取り合うと504 Outdated Requestで壊れるため）
		strictPort: true
	},
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-node: `npm run build` で build/ に自己完結なNodeサーバーを生成する
			// （npx配布用。localhost配信のみなので事前圧縮は不要）
			adapter: adapter({ out: 'build', precompress: false }),

			// kit標準CSRFチェックは handle フックより前に走り、ORIGIN 環境変数（単一値）と
			// しか比較できない。npx配布版は localhost / 127.0.0.1 / [::1] のどれでアクセス
			// されるか実行時まで分からないため無効化し、hooks.server.ts の
			// Origin ↔ Host 検証に一本化する
			csrf: { trustedOrigins: ['*'] }
		})
	]
});
