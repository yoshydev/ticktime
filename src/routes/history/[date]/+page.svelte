<script lang="ts">
	import { formatHM } from '$lib/duration';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	const detail = $derived(data.detail);
</script>

<p><a href="/history">← 履歴一覧</a></p>

<h1>{detail.workDate} の明細</h1>

{#if detail.entries.length === 0}
	<p class="muted">この日の確定明細はありません。</p>
{:else}
	<table>
		<thead>
			<tr>
				<th style="width:9rem">キー</th>
				<th>タイトル</th>
				<th style="width:6rem">確定時間</th>
				<th style="width:4rem">進捗</th>
				<th style="width:9rem">ステータス</th>
				<th style="width:6rem">フォーム</th>
			</tr>
		</thead>
		<tbody>
			{#each detail.entries as e (e.ticketKey)}
				<tr>
					<td>
						{#if e.jiraUrl}
							<a href={e.jiraUrl} target="_blank" rel="noopener">{e.ticketKey}</a>
						{:else}
							{e.ticketKey}
						{/if}
					</td>
					<td>{e.title}</td>
					<td class="time-cell">{formatHM(e.finalSeconds)}</td>
					<td class="time-cell">{e.progress}%</td>
					<td class="muted">{e.statusName}</td>
					<td>
						{#if e.formUrl}
							<a href={e.formUrl} target="_blank" rel="noopener">報告 →</a>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}
