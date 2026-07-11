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
import { findInvalidPlaceholders } from '$lib/template';
import { REPORT_URL_VARS } from '$lib/server/reportUrl';
import { COPY_TEMPLATE_VARS } from '$lib/copyTemplates';

/** 一般設定フォームで編集可能な設定キー。 */
const GENERAL_KEYS = ['user_name', 'project_name', 'report_url_template', 'jira_browse_base'] as const;

/** コピー用テンプレートの登録上限件数。 */
const COPY_TEMPLATE_LIMIT = 20;

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

		// 報告URLテンプレートは空を許可（空 = 報告リンク機能の無効化）
		if (values.report_url_template !== '') {
			if (!isSafeHttpUrl(values.report_url_template)) {
				return fail(400, {
					section: 'general',
					message: '報告URLテンプレートは http/https のURLを入力してください'
				});
			}
			// スキーム・ホスト・認証情報部の変数は拒否（リテラル必須）。
			// URL パーサは username/password の `{` を `%7B` に正規化するため、エンコード済み表現も検査する
			const url = new URL(values.report_url_template);
			const hasBrace = (part: string) => part.includes('{') || part.toLowerCase().includes('%7b');
			if (hasBrace(url.hostname) || hasBrace(url.username) || hasBrace(url.password)) {
				return fail(400, {
					section: 'general',
					message:
						'報告URLテンプレートのホスト部・認証情報部に変数は使えません（スキーム・ホストはリテラル必須）'
				});
			}
			const invalid = findInvalidPlaceholders(values.report_url_template, REPORT_URL_VARS);
			if (invalid.length > 0) {
				return fail(400, {
					section: 'general',
					message: `未知の変数 ${invalid.join(' ')} が含まれています`
				});
			}
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

	saveCopyTemplates: async ({ request }) => {
		const form = await request.formData();
		const labels = form.getAll('label').map((v) => String(v).trim());
		const templates = form.getAll('template').map((v) => String(v).trim());

		if (labels.length !== templates.length) {
			return fail(400, { section: 'copy', message: 'ラベルとテンプレートの件数が一致しません' });
		}
		if (labels.length > COPY_TEMPLATE_LIMIT) {
			return fail(400, {
				section: 'copy',
				message: `コピー用テンプレートは最大 ${COPY_TEMPLATE_LIMIT} 件までです`
			});
		}
		for (let i = 0; i < labels.length; i++) {
			if (labels[i] === '' || templates[i] === '') {
				return fail(400, {
					section: 'copy',
					message: `${i + 1} 行目: ラベルとテンプレートの両方を入力してください`
				});
			}
			const invalid = findInvalidPlaceholders(templates[i], COPY_TEMPLATE_VARS);
			if (invalid.length > 0) {
				return fail(400, {
					section: 'copy',
					message: `${i + 1} 行目: 未知の変数 ${invalid.join(' ')} が含まれています`
				});
			}
		}

		// 0行は '[]' 保存で正当（ボタン非表示）
		const json = JSON.stringify(labels.map((label, i) => ({ label, template: templates[i] })));
		updateSettings({ copy_templates: json });
		return { section: 'copy', ok: true };
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
