import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { currentWorkDate, stop } from '$lib/server/repo/sessions';
import {
	getClosingDraft,
	confirmClosing,
	type ClosingEntryInput,
	type ClosedEntry
} from '$lib/server/repo/closings';
import { listStatuses } from '$lib/server/repo/settings';
import { parseDuration } from '$lib/duration';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** クエリの date を検証し、不正なら当日の業務日付にフォールバックする。 */
function resolveDate(raw: string | null): string {
	if (raw && DATE_RE.test(raw)) return raw;
	return currentWorkDate();
}

export const load: PageServerLoad = ({ url }) => {
	const workDate = resolveDate(url.searchParams.get('date'));
	return {
		draft: getClosingDraft(workDate),
		statuses: listStatuses()
	};
};

export const actions: Actions = {
	stop: () => {
		stop();
		return { ok: true };
	},

	confirm: async ({ request }) => {
		const form = await request.formData();
		const workDate = resolveDate(String(form.get('date') ?? ''));

		const ids = String(form.get('ticketIds') ?? '')
			.split(',')
			.map((s) => Number(s))
			.filter((n) => Number.isInteger(n) && n > 0);

		const inputs: ClosingEntryInput[] = [];
		for (const ticketId of ids) {
			const finalRaw = String(form.get(`final_${ticketId}`) ?? '');
			const finalSeconds = parseDuration(finalRaw);
			if (finalSeconds === null) {
				return fail(400, { message: `確定時間の形式が不正です（h:mm）: "${finalRaw}"`, workDate });
			}
			const progress = Number(form.get(`progress_${ticketId}`));
			if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
				return fail(400, { message: '進捗%は0〜100の整数で入力してください', workDate });
			}
			const statusId = Number(form.get(`status_${ticketId}`));
			if (!Number.isInteger(statusId) || statusId <= 0) {
				return fail(400, { message: 'ステータスが不正です', workDate });
			}
			inputs.push({ ticketId, finalSeconds, progress, statusId });
		}

		let closed: ClosedEntry[];
		try {
			closed = confirmClosing(workDate, inputs);
		} catch (e) {
			return fail(400, {
				message: e instanceof Error ? e.message : '〆確定に失敗しました',
				workDate
			});
		}
		return { ok: true, closed, workDate };
	}
};
