<script lang="ts">
	import { formatHM } from '$lib/duration';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
</script>

<h1>履歴</h1>

<h2 class="group-title">〆済み日付</h2>
{#if data.closings.length === 0}
	<p class="muted">〆済みの日はまだありません。</p>
{:else}
	<div class="table-card">
		<table>
			<thead>
				<tr>
					<th style="width:10rem">業務日付</th>
					<th style="width:8rem">チケット数</th>
					<th style="width:8rem">合計時間</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.closings as c (c.workDate)}
					<tr>
						<td><a href={`/history/${c.workDate}`}>{c.workDate}</a></td>
						<td class="time-cell">{c.ticketCount}</td>
						<td class="time-cell">{formatHM(c.totalFinalSeconds)}</td>
						<td><a href={`/history/${c.workDate}`}>明細 →</a></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2 class="group-title">チケット別累計</h2>
{#if data.cumulative.length === 0}
	<p class="muted">チケットがありません。</p>
{:else}
	<div class="table-card">
		<table>
			<thead>
				<tr>
					<th style="width:10rem">キー</th>
					<th>タイトル</th>
					<th style="width:9rem">ステータス</th>
					<th style="width:8rem">累計時間</th>
				</tr>
			</thead>
			<tbody>
				{#each data.cumulative as t (t.ticketId)}
					<tr>
						<td>{t.key}</td>
						<td>{t.title}</td>
						<td class="muted">{t.statusName}</td>
						<td class="time-cell">{formatHM(t.totalSeconds)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="muted note">
		累計 = インポート分 + 〆済み確定時間の合計 + 未〆日の計測実測（走行中は現在まで）
	</p>
{/if}

<style>
	.note {
		margin-top: 0.5rem;
		font-size: 0.8rem;
	}
</style>
