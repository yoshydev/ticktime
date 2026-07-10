<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { formatHMS, formatHM } from '$lib/duration';
	import CopyButtons from '$lib/components/CopyButtons.svelte';
	import { statusColor } from '$lib/statusColor';
	import type { PageServerData, ActionData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const running = $derived(
		page.data.running as { ticketId: number; ticketKey: string } | null
	);

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

<!-- サマリーカード行（合計・計測中・〆状態） -->
<div class="summary-grid">
	<div class="summary-card">
		<span class="label">今日の合計</span>
		<span class="value">{formatHMS(data.dayTotalSeconds)}</span>
	</div>
	<div class="summary-card">
		<span class="label">計測中</span>
		{#if running}
			<span class="value running-value">{running.ticketKey}</span>
		{:else}
			<span class="value muted-value">なし</span>
		{/if}
	</div>
	<div class="summary-card">
		<span class="label">〆状態</span>
		{#if data.closed}
			<span class="value closed-value">〆済み</span>
		{:else}
			<span class="value muted-value">未〆</span>
		{/if}
		{#if data.reclosingBanner}
			<span class="sub">+{formatHM(data.reclosingBanner.extraSeconds)} 追加作業あり</span>
		{/if}
	</div>
</div>

{#if data.reclosingBanner}
	<div class="reclose-banner">
		本日は〆済みです。追加作業があります（+{formatHM(data.reclosingBanner.extraSeconds)}）。
		<a href="/close">再〆へ →</a>
	</div>
{/if}

{#each groups as group (group.kind)}
	<h2 class="group-title">{group.label}</h2>
	{#if group.tickets.length === 0}
		<p class="muted">チケットはありません</p>
	{:else}
		<div class="table-card">
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
							<td class="key-cell" style="border-left-color: {statusColor(t.statusId)}">
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
								<form method="POST" action="?/setStatus" use:enhance class="status-form">
									<input type="hidden" name="ticketId" value={t.id} />
									<span class="status-dot" style="background: {statusColor(t.statusId)}"></span>
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
							<td class="time-cell progress-cell">
								<div>{t.progress}%</div>
								<div class="progress-track">
									<div class="progress-fill" style="width: {t.progress}%"></div>
								</div>
							</td>
							<td class="time-cell">{formatHMS(t.todaySeconds)}</td>
							<td>
								{#if running?.ticketId === t.id}
									<span class="running-tag"><span class="live-dot"></span>計測中</span>
								{:else}
									<form method="POST" action="?/start" use:enhance>
										<input type="hidden" name="ticketId" value={t.id} />
										<button type="submit" class="btn btn-primary">▶ 開始</button>
									</form>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
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

<p><a href="/close">〆処理へ →</a></p>

<style>
	/* 計測中の行はアクセント淡色でハイライト（ホバー色より優先） */
	tbody tr.running,
	tbody tr.running:hover {
		background: var(--accent-soft);
	}
	.key-cell {
		border-left: 4px solid transparent;
	}
	.status-form {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.status-dot {
		flex: none;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
	}
	.progress-cell div:first-child {
		font-size: 0.9rem;
	}
	.progress-track {
		width: 100%;
		height: 4px;
		border-radius: 2px;
		background: var(--border-strong);
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		border-radius: 2px;
		background: var(--accent);
	}
	.running-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--accent);
		font-size: 0.9rem;
		white-space: nowrap;
	}
	.live-dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: var(--accent);
		animation: live-pulse 1.2s ease-in-out infinite;
	}
	@media (prefers-reduced-motion: reduce) {
		.live-dot {
			animation: none;
		}
	}
	@keyframes live-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.25;
		}
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
	.reclose-banner {
		color: var(--warn-fg);
		background: var(--warn-bg);
		border: 1px solid var(--warn-border);
		border-radius: var(--radius-m);
		padding: 0.75rem 1rem;
		margin-bottom: 1.25rem;
	}
	/* サマリーカードの状態別カラー */
	.summary-card .running-value {
		color: var(--accent);
	}
	.summary-card .closed-value {
		color: var(--ok-fg);
	}
	.summary-card .muted-value {
		color: var(--muted);
	}
</style>
