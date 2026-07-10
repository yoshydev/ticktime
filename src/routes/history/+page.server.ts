import type { PageServerLoad } from './$types';
import { listClosings } from '$lib/server/repo/closings';
import { cumulativeByTicket } from '$lib/server/repo/tickets';

export const load: PageServerLoad = () => {
	return {
		closings: listClosings(),
		cumulative: cumulativeByTicket()
	};
};
