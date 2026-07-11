<script lang="ts">
	import type { CopyTemplate } from '$lib/copyTemplates';
	import { renderTemplate } from '$lib/template';

	let {
		ticketKey,
		title,
		templates
	}: { ticketKey: string; title: string; templates: CopyTemplate[] } = $props();

	/** どのボタンをコピーしたか（フィードバック表示用）。 */
	let copied = $state<number | null>(null);
	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	// ユーザー定義テンプレートからコピー内容を生成する（URLエンコードなし）
	const items = $derived(
		templates.map((t, i) => ({
			id: i,
			label: t.label,
			value: renderTemplate(t.template, { ticket_key: ticketKey, title })
		}))
	);

	async function copy(id: number, value: string) {
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

{#if items.length > 0}
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
{/if}

<style>
	.copy-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-top: 0.25rem;
	}
	.copy-btn {
		font-size: 0.75rem;
		padding: 0.15rem 0.45rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--muted);
		background: var(--surface-2);
		cursor: pointer;
		white-space: nowrap;
		transition:
			background 150ms ease,
			border-color 150ms ease,
			color 150ms ease;
	}
	.copy-btn:hover {
		border-color: var(--border-strong);
		color: var(--fg);
	}
	.copy-btn.copied {
		color: var(--ok-fg);
		background: var(--ok-bg);
		border-color: var(--ok-border);
	}
</style>
