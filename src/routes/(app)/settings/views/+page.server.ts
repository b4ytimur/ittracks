import { getSettings, getViews } from '$lib/server/settings';
import { TEMPLATES } from '$lib/views';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const accountId = locals.account!.id;
	return {
		views: getViews(accountId),
		templates: TEMPLATES.map(({ id, name, blurb, summary }) => ({ id, name, blurb, summary })),
		ranges: getSettings(accountId).ranges.length
	};
};
