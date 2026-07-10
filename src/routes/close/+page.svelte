<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { formatHMS, formatHM } from '$lib/duration';
	import type { PageServerData, ActionData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const draft = $derived(data.draft);
	const ticketIds = $derived(draft.rows.map((r) => r.ticketId).join(','));

	// date input 変更でクエリを更新して再表示する
	function onDateChange(e: Event) {
		const value = (e.currentTarget as HTMLInputElement).value;
		if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
			goto(`/close?date=${value}`, { invalidateAll: true });
		}
	}

	const closed = $derived(form && 'closed' in form ? form.closed : null);
</script>

<h1>〆処理</h1>

<div class="date-bar">
	<label>
		対象業務日付
		<input type="date" value={draft.workDate} onchange={onDateChange} />
	</label>
	{#if draft.isClosed}
		<span class="badge closed">〆済み — 再〆（明細を作り直して上書き）します</span>
	{/if}
</div>

{#if form && 'message' in form && form.message}
	<p class="error">{form.message}</p>
{/if}

{#if draft.hasRunning}
	<div class="warn">
		<p>
			この日に走行中のタイマーがあります（<strong>{draft.runningTicketKey}</strong
			>）。計測に含めるには停止してください。停止するまで確定できません。
		</p>
		<form method="POST" action="?/stop" use:enhance>
			<button type="submit" class="btn">停止して集計に含める</button>
		</form>
	</div>
{/if}

{#if closed}
	<div class="done-box card">
		<h2>〆を確定しました（{form && 'workDate' in form ? form.workDate : ''}）</h2>
		{#if closed.length === 0}
			<p class="muted">確定時間が入った明細はありません。</p>
		{:else}
			<p>各チケットの報告フォーム（プレフィル済み）:</p>
			<ul class="form-links">
				{#each closed as e (e.ticketId)}
					<li>
						<a href={e.formUrl} target="_blank" rel="noopener">
							{e.ticketKey} — {e.title}（{formatHM(e.finalSeconds)} / 進捗{e.progress}%）
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

{#if draft.rows.length === 0}
	<p class="muted">この日に対象となるチケットはありません。</p>
{:else}
	<form method="POST" action="?/confirm" use:enhance>
		<input type="hidden" name="date" value={draft.workDate} />
		<input type="hidden" name="ticketIds" value={ticketIds} />
		<div class="table-card">
			<table>
				<thead>
					<tr>
						<th style="width:8rem">キー</th>
						<th>タイトル</th>
						<th style="width:6rem">計測</th>
						<th style="width:7rem">確定時間</th>
						<th style="width:5rem">進捗%</th>
						<th style="width:10rem">ステータス</th>
					</tr>
				</thead>
				<tbody>
					{#each draft.rows as r (r.ticketId)}
						<tr>
							<td>
								{#if r.jiraUrl}
									<a href={r.jiraUrl} target="_blank" rel="noopener">{r.ticketKey}</a>
								{:else}
									{r.ticketKey}
								{/if}
							</td>
							<td>{r.title}</td>
							<td class="time-cell muted">{formatHMS(r.measuredSeconds)}</td>
							<td>
								<input
									class="dur-input"
									name={`final_${r.ticketId}`}
									value={formatHM(r.initialFinalSeconds)}
									placeholder="h:mm"
								/>
							</td>
							<td>
								<input
									class="num-input"
									type="number"
									name={`progress_${r.ticketId}`}
									value={r.progress}
									min="0"
									max="100"
								/>
							</td>
							<td>
								<select name={`status_${r.ticketId}`} value={r.statusId}>
									{#each data.statuses as s (s.id)}
										<option value={s.id}>{s.name}</option>
									{/each}
								</select>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="confirm-bar">
			<button type="submit" class="btn btn-primary" disabled={draft.hasRunning}>
				{draft.isClosed ? '再〆して上書き' : '〆を確定'}
			</button>
			{#if draft.hasRunning}
				<span class="muted">走行中タイマーを停止するまで確定できません</span>
			{/if}
		</div>
	</form>
{/if}

<style>
	.date-bar {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	.date-bar label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.9rem;
	}
	.badge.closed {
		font-size: 0.85rem;
		color: var(--warn-fg);
		background: var(--warn-bg);
		border: 1px solid var(--warn-border);
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
	}
	.warn {
		color: var(--warn-fg);
		background: var(--warn-bg);
		border: 1px solid var(--warn-border);
		border-radius: var(--radius-m);
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
	}
	.warn p {
		margin: 0 0 0.5rem;
	}
	.done-box {
		margin-bottom: 1.25rem;
	}
	.done-box h2 {
		margin-top: 0;
		font-size: 1rem;
	}
	.form-links {
		margin: 0.5rem 0 0;
		padding-left: 1.2rem;
	}
	.form-links li {
		margin: 0.25rem 0;
	}
	.dur-input {
		width: 5rem;
		font-variant-numeric: tabular-nums;
	}
	.num-input {
		width: 4.5rem;
	}
	.confirm-bar {
		margin-top: 1rem;
		display: flex;
		align-items: center;
		gap: 1rem;
	}
</style>
