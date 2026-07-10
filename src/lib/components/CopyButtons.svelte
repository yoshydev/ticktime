<script lang="ts">
	let { ticketKey, title }: { ticketKey: string; title: string } = $props();

	/** どのボタンをコピーしたか（フィードバック表示用）。 */
	let copied = $state<string | null>(null);
	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	const items = $derived([
		{ id: 'branch', label: 'ブランチ', value: `feature/${ticketKey}` },
		{ id: 'pr', label: 'PRタイトル', value: `[WIP][${ticketKey}]${title}` },
		{ id: 'test', label: 'テスト仕様書', value: `${ticketKey}_${title}` }
	]);

	async function copy(id: string, value: string) {
		try {
			await navigator.clipboard.writeText(value);
			copied = id;
			clearTimeout(timeoutId);
			timeoutId = setTimeout(() => {
				copied = null;
			}, 1200);
		} catch {
			copied = null;
		}
	}
</script>

<span class="copy-buttons">
	{#each items as item (item.id)}
		<button
			type="button"
			class="copy-btn"
			class:copied={copied === item.id}
			title={item.value}
			onclick={() => copy(item.id, item.value)}
		>
			{copied === item.id ? '✓ コピー' : item.label}
		</button>
	{/each}
</span>

<style>
	.copy-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-top: 0.25rem;
	}
	.copy-btn {
		font-size: 0.75rem;
		padding: 0.15rem 0.4rem;
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--fg);
		background: var(--bg-soft);
		cursor: pointer;
		white-space: nowrap;
	}
	.copy-btn:hover {
		border-color: var(--muted);
	}
	.copy-btn.copied {
		color: var(--ok-fg);
		background: var(--ok-bg);
		border-color: var(--ok-border);
	}
</style>
