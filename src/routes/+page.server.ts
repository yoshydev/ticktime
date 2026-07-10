import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { listOpenTickets, addTicket, setStatus, type Ticket } from '$lib/server/repo/tickets';
import { listStatuses } from '$lib/server/repo/settings';
import { start, stop, secondsByTicketForDate, currentWorkDate } from '$lib/server/repo/sessions';
import { isClosed } from '$lib/server/repo/closings';

export interface TicketWithTime extends Ticket {
	todaySeconds: number;
}

export const load: PageServerLoad = () => {
	const workDate = currentWorkDate();
	const secByTicket = secondsByTicketForDate(workDate);
	const tickets: TicketWithTime[] = listOpenTickets().map((t) => ({
		...t,
		todaySeconds: secByTicket.get(t.id) ?? 0
	}));

	const dayTotalSeconds = [...secByTicket.values()].reduce((a, b) => a + b, 0);

	return {
		workDate,
		tickets,
		statuses: listStatuses(),
		dayTotalSeconds,
		closed: isClosed(workDate)
	};
};

export const actions: Actions = {
	start: async ({ request }) => {
		const form = await request.formData();
		const ticketId = Number(form.get('ticketId'));
		if (!Number.isInteger(ticketId) || ticketId <= 0) {
			return fail(400, { message: 'チケットが不正です' });
		}
		start(ticketId);
		return { ok: true };
	},

	stop: () => {
		stop();
		return { ok: true };
	},

	addTicket: async ({ request }) => {
		const form = await request.formData();
		const key = String(form.get('key') ?? '').trim();
		const title = String(form.get('title') ?? '').trim();
		if (key === '') {
			return fail(400, { message: 'チケット番号を入力してください', key, title });
		}
		try {
			addTicket({ key, title });
		} catch (e) {
			const msg = e instanceof Error && /UNIQUE/.test(e.message)
				? `チケット ${key} は既に存在します`
				: 'チケットの追加に失敗しました';
			return fail(400, { message: msg, key, title });
		}
		return { ok: true };
	},

	setStatus: async ({ request }) => {
		const form = await request.formData();
		const ticketId = Number(form.get('ticketId'));
		const statusId = Number(form.get('statusId'));
		if (!Number.isInteger(ticketId) || !Number.isInteger(statusId)) {
			return fail(400, { message: 'ステータス変更が不正です' });
		}
		setStatus(ticketId, statusId);
		return { ok: true };
	}
};
