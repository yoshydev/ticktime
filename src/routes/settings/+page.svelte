<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageServerData, ActionData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const s = $derived(data.settings);

	/** 指定セクションの成功メッセージを表示するか。 */
	function okFor(section: string): boolean {
		return !!form && 'ok' in form && form.ok === true && form.section === section;
	}
	/** 指定セクションのエラーメッセージ（なければ null）。 */
	function errorFor(section: string): string | null {
		return form && 'message' in form && form.message && form.section === section
			? form.message
			: null;
	}

	const jiraProbe = $derived(
		form && 'probe' in form && form.section === 'jira' ? form.probe : null
	);

	const kindLabels: Record<string, string> = {
		active: 'active（作業中）',
		pending: 'pending（保留）',
		done: 'done（完了）'
	};
</script>

<h1>設定</h1>

<!-- ===== 一般設定 ===== -->
<section>
	<h2 class="group-title">一般設定</h2>
	{#if okFor('general')}
		<p class="ok">保存しました</p>
	{/if}
	{#if errorFor('general')}
		<p class="error">{errorFor('general')}</p>
	{/if}
	<form method="POST" action="?/saveGeneral" use:enhance class="settings-form">
		<label>
			氏名
			<input name="user_name" value={s.user_name ?? ''} />
		</label>
		<label>
			プロジェクト名
			<input name="project_name" value={s.project_name ?? ''} />
		</label>
		<label class="wide">
			フォームベースURL（<code>.../viewform</code> まで。クエリは付けない）
			<input name="form_base_url" value={s.form_base_url ?? ''} />
		</label>

		<p class="hint">
			Google フォームの各項目の entry ID。<strong>報告日</strong>は 1 つの ID を入れると
			<code>_year</code> / <code>_month</code> / <code>_day</code> サフィックスは自動付与されます。
		</p>
		<div class="entry-grid">
			<label>
				氏名
				<input name="form_entry_name" value={s.form_entry_name ?? ''} />
			</label>
			<label>
				報告日
				<input name="form_entry_date" value={s.form_entry_date ?? ''} />
			</label>
			<label>
				タイトル
				<input name="form_entry_title" value={s.form_entry_title ?? ''} />
			</label>
			<label>
				Jira URL
				<input name="form_entry_jira_url" value={s.form_entry_jira_url ?? ''} />
			</label>
			<label>
				プロジェクト
				<input name="form_entry_project" value={s.form_entry_project ?? ''} />
			</label>
			<label>
				進捗%
				<input name="form_entry_progress" value={s.form_entry_progress ?? ''} />
			</label>
			<label>
				作業時間
				<input name="form_entry_hours" value={s.form_entry_hours ?? ''} />
			</label>
		</div>

		<label class="wide">
			Jira ブラウズベースURL（チケット URL 未指定時に <code>ベース + キー</code> で導出）
			<input name="jira_browse_base" value={s.jira_browse_base ?? ''} />
		</label>
		<label class="narrow">
			日付境界時刻（0〜23）
			<input
				type="number"
				name="day_boundary_hour"
				value={s.day_boundary_hour ?? '5'}
				min="0"
				max="23"
			/>
		</label>

		<div>
			<button type="submit" class="btn btn-primary">保存</button>
		</div>
	</form>
</section>

<!-- ===== ステータス管理 ===== -->
<section>
	<h2 class="group-title">ステータス管理</h2>
	{#if okFor('status')}
		<p class="ok">更新しました</p>
	{/if}
	{#if errorFor('status')}
		<p class="error">{errorFor('status')}</p>
	{/if}

	<table>
		<thead>
			<tr>
				<th>名前</th>
				<th style="width:11rem">区分</th>
				<th style="width:6rem">並び順</th>
				<th style="width:11rem"></th>
			</tr>
		</thead>
		<tbody>
			{#each data.statuses as st (st.id)}
				<tr>
					<td>
						<form method="POST" action="?/updateStatus" use:enhance id={`upd-${st.id}`}>
							<input type="hidden" name="id" value={st.id} />
							<input name="name" value={st.name} />
						</form>
					</td>
					<td>
						<select name="kind" value={st.kind} form={`upd-${st.id}`}>
							<option value="active">active</option>
							<option value="pending">pending</option>
							<option value="done">done</option>
						</select>
					</td>
					<td>
						<input
							class="num-input"
							type="number"
							name="sortOrder"
							value={st.sortOrder}
							form={`upd-${st.id}`}
						/>
					</td>
					<td class="row-actions">
						<button type="submit" class="btn" form={`upd-${st.id}`}>更新</button>
						<form method="POST" action="?/deleteStatus" use:enhance style="display:inline">
							<input type="hidden" name="id" value={st.id} />
							<button type="submit" class="btn btn-stop">削除</button>
						</form>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<form method="POST" action="?/addStatus" use:enhance class="add-status">
		<label>
			名前
			<input name="name" placeholder="新しいステータス" required />
		</label>
		<label>
			区分
			<select name="kind">
				{#each Object.keys(kindLabels) as k (k)}
					<option value={k}>{kindLabels[k]}</option>
				{/each}
			</select>
		</label>
		<label>
			並び順
			<input class="num-input" type="number" name="sortOrder" value="50" />
		</label>
		<button type="submit" class="btn">追加</button>
	</form>
	<p class="hint muted">tickets から参照されているステータスは削除できません。</p>
</section>

<!-- ===== Jira 疎通確認 ===== -->
<section>
	<h2 class="group-title">Jira 疎通確認</h2>
	{#if errorFor('jira')}
		<p class="error">{errorFor('jira')}</p>
	{/if}
	<form method="POST" action="?/probeJira" use:enhance>
		<button type="submit" class="btn">疎通確認する</button>
	</form>
	{#if jiraProbe}
		<ul class="probe-result">
			<li>
				設定ファイル（<code>~/.config/jira/config</code>）:
				<strong>{jiraProbe.configExists ? 'あり' : 'なし'}</strong>
			</li>
			<li>
				認証情報（email/token）:
				<strong>{jiraProbe.available ? '揃っている' : '不足'}</strong>
			</li>
			{#if jiraProbe.available}
				<li>
					myself プローブ:
					{#if jiraProbe.probe}
						<strong class:ng={!jiraProbe.probe.ok}>
							{jiraProbe.probe.ok ? 'OK' : 'NG'}
						</strong>
						（HTTP {jiraProbe.probe.status ?? 'ネットワークエラー'}）
					{:else}
						—
					{/if}
				</li>
			{/if}
		</ul>
		<p class="hint muted">メールアドレス・API トークンは表示されません。</p>
	{/if}
</section>

<style>
	section {
		margin-bottom: 2.5rem;
	}
	.settings-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 640px;
	}
	.settings-form label {
		display: flex;
		flex-direction: column;
		font-size: 0.85rem;
		gap: 0.25rem;
		color: var(--muted);
	}
	.settings-form input {
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 5px;
		font: inherit;
	}
	.settings-form .narrow input {
		max-width: 8rem;
	}
	.entry-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.6rem;
	}
	.entry-grid label {
		display: flex;
		flex-direction: column;
		font-size: 0.85rem;
		gap: 0.25rem;
		color: var(--muted);
	}
	.entry-grid input {
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 5px;
		font: inherit;
	}
	.hint {
		font-size: 0.8rem;
		color: var(--muted);
		margin: 0.25rem 0;
	}
	.num-input {
		width: 5rem;
		padding: 0.3rem 0.4rem;
		border: 1px solid var(--border);
		border-radius: 5px;
		font: inherit;
	}
	.row-actions {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.add-status {
		display: flex;
		gap: 0.6rem;
		align-items: flex-end;
		flex-wrap: wrap;
		margin-top: 1rem;
		padding: 1rem;
		background: var(--bg-soft);
		border-radius: 8px;
	}
	.add-status label {
		display: flex;
		flex-direction: column;
		font-size: 0.8rem;
		gap: 0.2rem;
		color: var(--muted);
	}
	.add-status input {
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 5px;
		font: inherit;
	}
	.probe-result {
		margin: 0.75rem 0 0.25rem;
		padding-left: 1.2rem;
	}
	.probe-result li {
		margin: 0.2rem 0;
	}
	.probe-result .ng {
		color: #c0392b;
	}
	.ok {
		color: #1e7a3c;
		background: #e7f6ec;
		border: 1px solid #a9dcbb;
		padding: 0.4rem 0.7rem;
		border-radius: 6px;
	}
	.error {
		color: #c0392b;
		background: #fdecea;
		border: 1px solid #f5c6c2;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
	}
</style>
