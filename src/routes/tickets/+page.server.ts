import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	listAllTickets,
	updateTicket,
	deleteTicket,
	referencedTicketIds,
	cumulativeByTicket,
	type Ticket
} from '$lib/server/repo/tickets';
import { listStatuses } from '$lib/server/repo/settings';

export interface TicketWithStats extends Ticket {
	totalSeconds: number;
	referenced: boolean;
}

export const load: PageServerLoad = () => {
	const cumulative = cumulativeByTicket();
	const totalByTicket = new Map(cumulative.map((c) => [c.ticketId, c.totalSeconds]));
	const referenced = referencedTicketIds();

	const tickets: TicketWithStats[] = listAllTickets().map((t) => ({
		...t,
		totalSeconds: totalByTicket.get(t.id) ?? 0,
		referenced: referenced.has(t.id)
	}));

	return { tickets, statuses: listStatuses() };
};

export const actions: Actions = {
	update: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const key = String(form.get('key') ?? '').trim();
		const title = String(form.get('title') ?? '').trim();
		const jiraUrlRaw = String(form.get('jiraUrl') ?? '').trim();
		const jiraUrl = jiraUrlRaw === '' ? null : jiraUrlRaw;
		const statusId = Number(form.get('statusId'));
		const progress = Number(form.get('progress'));

		if (!Number.isInteger(id) || id <= 0) {
			return fail(400, { message: 'チケットが不正です' });
		}
		if (key === '') {
			return fail(400, { message: 'チケット番号を入力してください' });
		}
		if (!Number.isInteger(statusId) || statusId <= 0) {
			return fail(400, { message: 'ステータスが不正です' });
		}
		if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
			return fail(400, { message: '進捗は0〜100の整数で入力してください' });
		}

		try {
			updateTicket({ id, key, title, jiraUrl, statusId, progress });
		} catch (e) {
			const msg =
				e instanceof Error && /UNIQUE/.test(e.message)
					? `チケット番号 "${key}" は既に存在します`
					: e instanceof Error
						? e.message
						: 'チケットの更新に失敗しました';
			return fail(400, { message: msg });
		}
		return { ok: true };
	},

	delete: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id) || id <= 0) {
			return fail(400, { message: 'チケットが不正です' });
		}
		try {
			deleteTicket(id);
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'チケットの削除に失敗しました';
			return fail(400, { message: msg });
		}
		return { ok: true };
	}
};
