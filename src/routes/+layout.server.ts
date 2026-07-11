import type { LayoutServerLoad } from './$types';
import { getRunning } from '$lib/server/repo/sessions';
import { getSetting } from '$lib/server/repo/settings';
import { parseCopyTemplates } from '$lib/copyTemplates';

export const load: LayoutServerLoad = () => {
	return {
		running: getRunning(),
		copyTemplates: parseCopyTemplates(getSetting('copy_templates', '[]'))
	};
};
