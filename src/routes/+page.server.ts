import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	listOpenTickets,
	addTicket,
	setStatus,
	ticketExists,
	type Ticket
} from '$lib/server/repo/tickets';
import { listStatuses, statusExists } from '$lib/server/repo/settings';
import { isSafeHttpUrl } from '$lib/url';
import {
	start,
	stop,
	secondsByTicketForDate,
	currentWorkDate,
	hasSessionStartedAfter
} from '$lib/server/repo/sessions';
import { isClosed, getClosingInfo } from '$lib/server/repo/closings';

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

	const closingInfo = getClosingInfo(workDate);
	const reclosingBanner =
		closingInfo &&
		(dayTotalSeconds > closingInfo.measuredTotalSeconds ||
			hasSessionStartedAfter(workDate, closingInfo.closedAt))
			? { extraSeconds: Math.max(dayTotalSeconds - closingInfo.measuredTotalSeconds, 0) }
			: null;

	return {
		workDate,
		tickets,
		statuses: listStatuses(),
		dayTotalSeconds,
		closed: isClosed(workDate),
		reclosingBanner
	};
};

export const actions: Actions = {
	start: async ({ request }) => {
		const form = await request.formData();
		const ticketId = Number(form.get('ticketId'));
		if (!Number.isInteger(ticketId) || ticketId <= 0) {
			return fail(400, { message: 'チケットが不正です' });
		}
		if (!ticketExists(ticketId)) {
			return fail(400, { message: '指定されたチケットが存在しません' });
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
		const jiraUrlRaw = String(form.get('jiraUrl') ?? '').trim();
		if (key === '') {
			return fail(400, { message: 'チケット番号を入力してください', key, title });
		}
		if (jiraUrlRaw !== '' && !isSafeHttpUrl(jiraUrlRaw)) {
			return fail(400, { message: 'Jira URL は http/https のURLを入力してください', key, title });
		}
		const jiraUrl = jiraUrlRaw === '' ? null : jiraUrlRaw;
		try {
			addTicket({ key, title, jiraUrl });
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
		if (!ticketExists(ticketId)) {
			return fail(400, { message: '指定されたチケットが存在しません' });
		}
		if (!statusExists(statusId)) {
			return fail(400, { message: '指定されたステータスが存在しません' });
		}
		setStatus(ticketId, statusId);
		return { ok: true };
	}
};
