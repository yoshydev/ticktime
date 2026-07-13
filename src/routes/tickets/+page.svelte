<script lang="ts">
	import { enhance } from '$app/forms';
	import { withErrorAlert } from '$lib/enhanceWithAlert';
	import { formatHMS } from '$lib/duration';
	import CopyButtons from '$lib/components/CopyButtons.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<h1>チケット管理</h1>

{#if form && 'message' in form && form.message}
	<p class="error">{form.message}</p>
{/if}

{#if data.tickets.length === 0}
	<p class="muted">チケットはありません</p>
{:else}
	<div class="table-card">
		<table>
			<thead>
				<tr>
					<th style="width:10rem">キー</th>
					<th>タイトル</th>
					<th style="width:12rem">Jira URL</th>
					<th style="width:9rem">ステータス</th>
					<th style="width:4rem">進捗</th>
					<th style="width:6rem">累計</th>
					<th style="width:7rem">作成日</th>
					<th style="width:5rem">操作</th>
				</tr>
			</thead>
			<tbody>
				{#each data.tickets as t (t.id)}
					{@const formId = `update-${t.id}`}
					<tr>
						<td>
							<form id={formId} method="POST" action="?/update" use:enhance={withErrorAlert()}>
								<input type="hidden" name="id" value={t.id} />
							</form>
							<input class="text-input" form={formId} name="key" value={t.key} />
						</td>
						<td class="title-cell">
							<input class="text-input" form={formId} name="title" value={t.title} />
							<CopyButtons ticketKey={t.key} title={t.title} templates={data.copyTemplates} />
						</td>
						<td>
							<input
								class="text-input"
								form={formId}
								name="jiraUrl"
								value={t.jiraUrl ?? ''}
								placeholder="未設定"
							/>
						</td>
						<td>
							<select form={formId} name="statusId" value={t.statusId}>
								{#each data.statuses as s (s.id)}
									<option value={s.id}>{s.name}</option>
								{/each}
							</select>
						</td>
						<td>
							<input
								class="num-input"
								form={formId}
								type="number"
								name="progress"
								value={t.progress}
								min="0"
								max="100"
							/>
						</td>
						<td class="time-cell">{formatHMS(t.totalSeconds)}</td>
						<td>{new Date(t.createdAt).toLocaleDateString('ja-JP')}</td>
						<td>
							<button type="submit" form={formId} class="btn">保存</button>
							{#if t.referenced}
								<span class="muted">計測履歴あり</span>
							{:else}
								<form
									method="POST"
									action="?/delete"
									use:enhance={withErrorAlert(({ cancel }) => {
										if (!confirm('本当に削除しますか？')) cancel();
									})}
								>
									<input type="hidden" name="id" value={t.id} />
									<button type="submit" class="btn btn-danger">削除</button>
								</form>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<p><a href="/">今日へ戻る →</a></p>

<style>
	.title-cell {
		min-width: 14rem;
		padding-top: 0.4rem;
		padding-bottom: 0.4rem;
	}
	.text-input {
		width: 100%;
	}
	.num-input {
		width: 4.5rem;
	}
</style>
