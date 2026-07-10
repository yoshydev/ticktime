<script lang="ts">
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
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>ticktime</title>
</svelte:head>

<header class="app-header">
	<div class="bar">
		<nav class="app-nav">
			{#each navItems as item (item.href)}
				<a href={item.href} aria-current={page.url.pathname === item.href ? 'page' : undefined}
					>{item.label}</a
				>
			{/each}
		</nav>

		{#if running}
			<div class="running-badge">
				<span class="key">{running.ticketKey}</span>
				<Timer startedAt={running.startedAt} />
				<form method="POST" action="/?/stop" use:enhance>
					<button type="submit" class="btn btn-stop">停止</button>
				</form>
			</div>
		{:else}
			<div class="running-badge idle">計測なし</div>
		{/if}
	</div>
</header>

<main class="container">
	{@render children()}
</main>
