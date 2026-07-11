<script lang="ts">
	import '@fontsource-variable/inter/index.css';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Timer from '$lib/components/Timer.svelte';
	import type { Snippet } from 'svelte';
	import type { LayoutServerData } from './$types';

	let { children, data }: { children: Snippet; data: LayoutServerData } = $props();

	const running = $derived(data.running);

	const navItems = [
		{ href: '/', label: '今日' },
		{ href: '/close', label: '〆処理' },
		{ href: '/history', label: '履歴' },
		{ href: '/tickets', label: 'チケット' },
		{ href: '/settings', label: '設定' }
	];

	/** ナビのアクティブ判定。`/` は完全一致、それ以外は前方一致（配下ページも含む）。 */
	function isActive(href: string): boolean {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>ticktime</title>
</svelte:head>

<header class="app-header">
	<div class="bar">
		<a href="/" class="wordmark"><span class="mark">◈</span>ticktime</a>

		<nav class="app-nav">
			{#each navItems as item (item.href)}
				<a href={item.href} aria-current={isActive(item.href) ? 'page' : undefined}
					>{item.label}</a
				>
			{/each}
		</nav>

		{#if running}
			<div class="running-badge">
				<span class="live-dot"></span>
				<span class="key">{running.ticketKey}</span>
				<Timer startedAt={running.startedAt} />
				<form method="POST" action="/?/stop" use:enhance>
					<button type="submit" class="btn btn-danger">停止</button>
				</form>
			</div>
		{:else}
			<div class="running-badge idle">計測なし</div>
		{/if}
	</div>
</header>

{#if data.setupNeeded && page.url.pathname !== '/settings'}
	<div class="container banner-container">
		<div class="setup-banner">
			はじめての方へ: まずは<a href="/settings">設定画面</a
			>で氏名や報告URLテンプレートを登録しましょう（〆処理時の報告リンク生成などに使われます）。
		</div>
	</div>
{/if}

<main class="container">
	{@render children()}
</main>

<style>
	/* 初回セットアップ誘導バナー（警告色ではなくアクセント系の淡い情報バナー） */
	/* .container の下パディング(4rem)は本文用なので、バナー行では打ち消す */
	.banner-container {
		padding-bottom: 0;
	}
	.setup-banner {
		color: var(--accent);
		background: var(--accent-soft);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		border-radius: var(--radius-m);
		padding: 0.75rem 1rem;
		margin-top: 1.25rem;
	}
	.setup-banner a {
		color: var(--accent);
		font-weight: 600;
		text-decoration: underline;
	}
</style>
