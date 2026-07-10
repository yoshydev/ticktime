import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getAllSettings,
	listStatuses,
	updateSettings,
	addStatus,
	updateStatus,
	deleteStatus,
	type Status
} from '$lib/server/repo/settings';
import { probeConnection, type JiraProbeResult } from '$lib/server/jira';
import { isSafeHttpUrl } from '$lib/url';

/** 一般設定フォームで編集可能な設定キー（entry ID は 6 項目）。 */
const GENERAL_KEYS = [
	'user_name',
	'project_name',
	'form_base_url',
	'form_entry_name',
	'form_entry_date',
	'form_entry_title',
	'form_entry_jira_url',
	'form_entry_progress',
	'form_entry_hours',
	'jira_browse_base'
] as const;

const VALID_KINDS: Status['kind'][] = ['active', 'pending', 'done'];

function isKind(v: string): v is Status['kind'] {
	return (VALID_KINDS as string[]).includes(v);
}

export const load: PageServerLoad = () => {
	return {
		settings: getAllSettings(),
		statuses: listStatuses()
	};
};

export const actions: Actions = {
	saveGeneral: async ({ request }) => {
		const form = await request.formData();
		const values: Record<string, string> = {};
		for (const key of GENERAL_KEYS) {
			values[key] = String(form.get(key) ?? '').trim();
		}

		const boundaryRaw = String(form.get('day_boundary_hour') ?? '').trim();
		const boundary = Number(boundaryRaw);
		if (!Number.isInteger(boundary) || boundary < 0 || boundary > 23) {
			return fail(400, { section: 'general', message: '日付境界時刻は 0〜23 の整数で入力してください' });
		}
		values.day_boundary_hour = String(boundary);

		if (values.form_base_url === '') {
			return fail(400, { section: 'general', message: 'フォームベースURLは必須です' });
		}
		if (!isSafeHttpUrl(values.form_base_url)) {
			return fail(400, {
				section: 'general',
				message: 'フォームベースURLは http/https のURLを入力してください'
			});
		}
		if (values.jira_browse_base !== '' && !isSafeHttpUrl(values.jira_browse_base)) {
			return fail(400, {
				section: 'general',
				message: 'Jira ブラウズベースURLは http/https のURLを入力してください'
			});
		}

		updateSettings(values);
		return { section: 'general', ok: true };
	},

	addStatus: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const kind = String(form.get('kind') ?? '');
		const sortOrder = Number(form.get('sortOrder'));
		if (name === '') {
			return fail(400, { section: 'status', message: 'ステータス名を入力してください' });
		}
		if (!isKind(kind)) {
			return fail(400, { section: 'status', message: '区分が不正です' });
		}
		if (!Number.isInteger(sortOrder)) {
			return fail(400, { section: 'status', message: '並び順は整数で入力してください' });
		}
		try {
			addStatus(name, kind, sortOrder);
		} catch (e) {
			const msg =
				e instanceof Error && /UNIQUE/.test(e.message)
					? `ステータス「${name}」は既に存在します`
					: 'ステータスの追加に失敗しました';
			return fail(400, { section: 'status', message: msg });
		}
		return { section: 'status', ok: true };
	},

	updateStatus: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const name = String(form.get('name') ?? '').trim();
		const kind = String(form.get('kind') ?? '');
		const sortOrder = Number(form.get('sortOrder'));
		if (!Number.isInteger(id) || id <= 0) {
			return fail(400, { section: 'status', message: 'ステータスが不正です' });
		}
		if (name === '') {
			return fail(400, { section: 'status', message: 'ステータス名を入力してください' });
		}
		if (!isKind(kind)) {
			return fail(400, { section: 'status', message: '区分が不正です' });
		}
		if (!Number.isInteger(sortOrder)) {
			return fail(400, { section: 'status', message: '並び順は整数で入力してください' });
		}
		try {
			updateStatus(id, name, kind, sortOrder);
		} catch (e) {
			const msg =
				e instanceof Error && /UNIQUE/.test(e.message)
					? `ステータス「${name}」は既に存在します`
					: 'ステータスの更新に失敗しました';
			return fail(400, { section: 'status', message: msg });
		}
		return { section: 'status', ok: true };
	},

	deleteStatus: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id) || id <= 0) {
			return fail(400, { section: 'status', message: 'ステータスが不正です' });
		}
		try {
			deleteStatus(id);
		} catch (e) {
			return fail(400, {
				section: 'status',
				message: e instanceof Error ? e.message : 'ステータスの削除に失敗しました'
			});
		}
		return { section: 'status', ok: true };
	},

	probeJira: async () => {
		let probe: JiraProbeResult;
		try {
			probe = await probeConnection();
		} catch {
			return fail(500, { section: 'jira', message: '疎通確認に失敗しました' });
		}
		return { section: 'jira', probe };
	}
};
