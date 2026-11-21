import { getSettings, getViews } from '$lib/server/settings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const accountId = locals.account!.id;
	return { views: getViews(accountId), ranges: getSettings(accountId).ranges.length };
};
