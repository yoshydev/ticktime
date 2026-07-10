import type { LayoutServerLoad } from './$types';
import { getRunning } from '$lib/server/repo/sessions';

export const load: LayoutServerLoad = () => {
	return {
		running: getRunning()
	};
};
