<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { formatHMS, formatHM } from '$lib/duration';
	import CopyButtons from '$lib/components/CopyButtons.svelte';
	import type { PageServerData, ActionData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const running = $derived(page.data.running as { ticketId: number } | null);

	// チケット追加フォームの入力（Jira 取得ボタンと双方向バインドするため $state で保持）
	let keyInput = $state('');
	let titleInput = $state('');
	let jiraMsg = $state<string | null>(null);
	let jiraLoading = $state(false);

	/** 入力中のキーで /api/jira/<key> を叩き、成功したらタイトル欄へ反映する。 */
	async function fetchJiraTitle() {
		const key = keyInput.trim();
		if (key === '') {
			jiraMsg = 'チケット番号を入力してください';
			return;
		}
		jiraLoading = true;
		jiraMsg = null;
		try {
			const res = await fetch(`/api/jira/${encodeURIComponent(key)}`);
			const body = (await res.json()) as { title?: string; error?: string };
			if (res.ok && body.title) {
				titleInput = body.title;
				jiraMsg = null;
			} else if (body.error === 'not_configured') {
				jiraMsg = 'Jira 設定がありません。タイトルは手入力してください。';
			} else if (body.error === 'invalid_key') {
				jiraMsg = 'チケット番号の形式が不正です（例: TICKET-1234）';
			} else {
				jiraMsg = 'タイトルの取得に失敗しました。手入力してください。';
			}
		} catch {
			jiraMsg = '取得中にエラーが発生しました。手入力してください。';
		} finally {
			jiraLoading = false;
		}
	}

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
					<th style="width:10rem">キー</th>
					<th>タイトル</th>
					<th style="width:9rem">ステータス</th>
					<th style="width:4rem">進捗</th>
					<th style="width:6rem">今日</th>
					<th style="width:5rem">計測</th>
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
						<td class="title-cell">
							<div>{t.title}</div>
							<CopyButtons ticketKey={t.key} title={t.title} />
						</td>
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
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
{/each}

<form
	class="add-form"
	method="POST"
	action="?/addTicket"
	use:enhance={() => {
		return async ({ result, update }) => {
			await update();
			if (result.type === 'success') {
				keyInput = '';
				titleInput = '';
				jiraMsg = null;
			}
		};
	}}
>
	<label>
		チケット番号
		<input name="key" placeholder="TICKET-1234" required bind:value={keyInput} />
	</label>
	<button
		type="button"
		class="btn"
		onclick={fetchJiraTitle}
		disabled={jiraLoading || keyInput.trim() === ''}
	>
		{jiraLoading ? '取得中…' : 'Jiraから取得'}
	</button>
	<label>
		タイトル（任意）
		<input name="title" placeholder="未入力なら番号を仮タイトルに" bind:value={titleInput} />
	</label>
	<button type="submit" class="btn">追加</button>
</form>
{#if jiraMsg}
	<p class="jira-msg">{jiraMsg}</p>
{/if}

{#if data.reclosingBanner}
	<div class="reclose-banner">
		本日は〆済みです。追加作業があります（+{formatHM(data.reclosingBanner.extraSeconds)}）。
		<a href="/close">再〆へ →</a>
	</div>
{/if}

<p class="day-total">
	今日の合計: <strong>{formatHMS(data.dayTotalSeconds)}</strong>
	{#if data.closed}
		<span class="closed-tag">本日は〆済み</span>
	{/if}
</p>

<p><a href="/close">〆処理へ →</a></p>

<style>
	tr.running {
		background: var(--warn-bg);
	}
	.title-cell {
		padding-top: 0.4rem;
		padding-bottom: 0.4rem;
	}
	.jira-msg {
		margin: -0.5rem 0 0.5rem;
		font-size: 0.85rem;
		color: var(--warn-fg);
	}
	.closed-tag {
		margin-left: 0.75rem;
		font-size: 0.8rem;
		color: var(--warn-fg);
		background: var(--warn-bg);
		border: 1px solid var(--warn-border);
		padding: 0.15rem 0.5rem;
		border-radius: 6px;
		vertical-align: middle;
	}
	.reclose-banner {
		color: var(--warn-fg);
		background: var(--warn-bg);
		border: 1px solid var(--warn-border);
		border-radius: 8px;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
	}
</style>
