<script lang="ts">
	import { enhance } from '$app/forms';
	import { parseCopyTemplates, type CopyTemplate } from '$lib/copyTemplates';
	import type { PageServerData, ActionData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const s = $derived(data.settings);

	/** コピー用テンプレートの編集用ローカル配列（行の追加・削除をクライアント側で行う）。
	 * 初期値のみ data から取り、以後はローカル編集する意図なので初期値キャプチャで正しい。 */
	// svelte-ignore state_referenced_locally
	let copyRows = $state<CopyTemplate[]>(parseCopyTemplates(data.settings.copy_templates ?? '[]'));

	function addCopyRow() {
		copyRows.push({ label: '', template: '' });
	}
	function removeCopyRow(index: number) {
		copyRows.splice(index, 1);
	}

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
	<form method="POST" action="?/saveGeneral" use:enhance class="settings-form card">
		<label>
			氏名
			<input name="user_name" value={s.user_name ?? ''} />
		</label>
		<label>
			プロジェクト名
			<input name="project_name" value={s.project_name ?? ''} />
		</label>
		<label class="wide">
			報告URLテンプレート（〆確定時の報告リンクを生成）
			<textarea name="report_url_template" rows="4">{s.report_url_template ?? ''}</textarea>
		</label>
		<p class="hint">
			利用可能な変数:
			<code>{'{user_name}'}</code>
			<code>{'{project_name}'}</code>
			<code>{'{date}'}</code>
			<code>{'{date_year}'}</code>
			<code>{'{date_month}'}</code>
			<code>{'{date_day}'}</code>
			<code>{'{ticket_key}'}</code>
			<code>{'{title}'}</code>
			<code>{'{jira_url}'}</code>
			<code>{'{hours}'}</code>
			<code>{'{progress}'}</code>
			<code>{'{status}'}</code>
			<br />
			変数はURLエンコードされて埋め込まれます。スキーム・ホスト部はリテラル必須（変数は使えません）。
			空にすると報告リンク機能を無効化します。
		</p>

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

<!-- ===== コピー用テンプレート ===== -->
<section>
	<h2 class="group-title">コピー用テンプレート</h2>
	{#if okFor('copy')}
		<p class="ok">保存しました</p>
	{/if}
	{#if errorFor('copy')}
		<p class="error">{errorFor('copy')}</p>
	{/if}
	<form method="POST" action="?/saveCopyTemplates" use:enhance class="settings-form card">
		<p class="hint">
			チケット一覧・今日ページのコピーボタンになります。利用可能な変数:
			<code>{'{ticket_key}'}</code>
			<code>{'{title}'}</code>
		</p>
		{#if copyRows.length === 0}
			<p class="hint muted">テンプレートがありません（コピーボタンは表示されません）。</p>
		{/if}
		{#each copyRows as row, i (i)}
			<div class="copy-row">
				<label>
					ラベル
					<input name="label" bind:value={row.label} placeholder="ブランチ" />
				</label>
				<label class="grow">
					テンプレート
					<input name="template" bind:value={row.template} placeholder={'feature/{ticket_key}'} />
				</label>
				<button type="button" class="btn btn-danger" onclick={() => removeCopyRow(i)}>削除</button>
			</div>
		{/each}
		<div class="copy-actions">
			<button type="button" class="btn" onclick={addCopyRow}>行を追加</button>
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

	<div class="table-card">
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
								<button type="submit" class="btn btn-danger">削除</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<form method="POST" action="?/addStatus" use:enhance class="add-status card">
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
		<div class="probe-box card">
			<ul class="probe-result">
				<li>
					設定ファイル（<code>~/.config/jira/config</code>）:
					<strong>{jiraProbe.configExists ? 'あり' : 'なし'}</strong>
				</li>
				<li>
					接続設定（site/email/token）:
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
		</div>
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
	.settings-form .narrow input {
		max-width: 8rem;
	}
	/* textarea は app.css の input と同じトークンで揃える */
	.settings-form textarea {
		resize: vertical;
		padding: 0.35rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		font: inherit;
		background: var(--surface-2);
		color: var(--fg);
		transition:
			border-color 150ms ease,
			box-shadow 150ms ease;
	}
	.settings-form textarea:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.copy-row {
		display: flex;
		gap: 0.6rem;
		align-items: flex-end;
	}
	.copy-row label {
		display: flex;
		flex-direction: column;
		font-size: 0.85rem;
		gap: 0.25rem;
		color: var(--muted);
	}
	.copy-row .grow {
		flex: 1;
	}
	.copy-actions {
		display: flex;
		gap: 0.6rem;
	}
	.hint {
		font-size: 0.8rem;
		color: var(--muted);
		margin: 0.25rem 0;
	}
	.num-input {
		width: 5rem;
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
	}
	.add-status label {
		display: flex;
		flex-direction: column;
		font-size: 0.8rem;
		gap: 0.2rem;
		color: var(--muted);
	}
	.probe-box {
		margin-top: 0.75rem;
		max-width: 640px;
	}
	.probe-result {
		margin: 0 0 0.25rem;
		padding-left: 1.2rem;
	}
	.probe-result li {
		margin: 0.2rem 0;
	}
	.probe-result .ng {
		color: var(--error-fg);
	}
</style>
