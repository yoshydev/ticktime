import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getClosingDetail } from '$lib/server/repo/closings';

export const load: PageServerLoad = ({ params }) => {
	const detail = getClosingDetail(params.date);
	if (!detail) {
		throw error(404, `${params.date} の〆履歴は存在しません`);
	}
	return { detail };
};
