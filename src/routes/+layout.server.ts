import type { LayoutServerLoad } from './$types';
import { getRunning } from '$lib/server/repo/sessions';
import { getSetting } from '$lib/server/repo/settings';
import { parseCopyTemplates } from '$lib/copyTemplates';

export const load: LayoutServerLoad = () => {
	return {
		running: getRunning(),
		copyTemplates: parseCopyTemplates(getSetting('copy_templates', '[]')),
		// 初回セットアップ誘導バナーの表示条件（氏名を保存すると自動で消える）
		setupNeeded: getSetting('user_name').trim() === ''
	};
};
