<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { formatHMS } from '$lib/duration';
	import CopyButtons from '$lib/components/CopyButtons.svelte';
	import type { PageServerData, ActionData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const running = $derived(page.data.running as { ticketId: number } | null);

	const groups = $derived([
		{
			kind: 'active',
			label: '進行中・確認中',
			tickets: data.tickets.filter((t) => t.statusKind === 'active')
		},
		{
			kind: 'pending',
			label: '保留中',
			tickets: data.tickets.filter((t) => t.statusKind === 'pending')
		}
	]);
</script>

<h1>今日 <span class="muted" style="font-size:0.8rem">({data.workDate})</span></h1>

{#if form && 'message' in form && form.message}
	<p class="error">{form.message}</p>
{/if}

{#each groups as group (group.kind)}
	<h2 class="group-title">{group.label}</h2>
	{#if group.tickets.length === 0}
		<p class="muted">チケットはありません</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th style="width:8rem">キー</th>
					<th>タイトル</th>
					<th style="width:9rem">ステータス</th>
					<th style="width:4rem">進捗</th>
					<th style="width:6rem">今日</th>
					<th style="width:5rem">計測</th>
					<th style="width:15rem">コピー</th>
				</tr>
			</thead>
			<tbody>
				{#each group.tickets as t (t.id)}
					<tr class:running={running?.ticketId === t.id}>
						<td>
							{#if t.jiraUrl}
								<a href={t.jiraUrl} target="_blank" rel="noreferrer">{t.key}</a>
							{:else}
								{t.key}
							{/if}
						</td>
						<td>{t.title}</td>
						<td>
							<form method="POST" action="?/setStatus" use:enhance>
								<input type="hidden" name="ticketId" value={t.id} />
								<select
									name="statusId"
									value={t.statusId}
									onchange={(e) => e.currentTarget.form?.requestSubmit()}
								>
									{#each data.statuses as s (s.id)}
										<option value={s.id}>{s.name}</option>
									{/each}
								</select>
							</form>
						</td>
						<td class="time-cell">{t.progress}%</td>
						<td class="time-cell">{formatHMS(t.todaySeconds)}</td>
						<td>
							<form method="POST" action="?/start" use:enhance>
								<input type="hidden" name="ticketId" value={t.id} />
								<button
									type="submit"
									class="btn btn-primary"
									disabled={running?.ticketId === t.id}
								>
									▶ 開始
								</button>
							</form>
						</td>
						<td><CopyButtons ticketKey={t.key} title={t.title} /></td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
{/each}

<form class="add-form" method="POST" action="?/addTicket" use:enhance>
	<label>
		チケット番号
		<input
			name="key"
			placeholder="TICKET-1234"
			required
			value={form && 'key' in form ? (form.key ?? '') : ''}
		/>
	</label>
	<label>
		タイトル（任意）
		<input
			name="title"
			placeholder="未入力なら番号を仮タイトルに"
			value={form && 'title' in form ? (form.title ?? '') : ''}
		/>
	</label>
	<button type="submit" class="btn">追加</button>
</form>

<p class="day-total">今日の合計: <strong>{formatHMS(data.dayTotalSeconds)}</strong></p>

<p><a href="/close">〆処理へ →</a></p>

<style>
	tr.running {
		background: #fff8e6;
	}
	.error {
		color: #c0392b;
		background: #fdecea;
		border: 1px solid #f5c6c2;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
	}
</style>
