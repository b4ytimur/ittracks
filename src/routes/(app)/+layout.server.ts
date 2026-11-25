import { redirect } from '@sveltejs/kit';
import { accountCount } from '$lib/server/auth';
import { getGroupings, getKinds, tagGroups } from '$lib/server/settings';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.account) redirect(303, accountCount() === 0 ? '/setup' : '/login');
	// A quick-log link opened with a key shows its answer without the app around it.
	const id = locals.account.id;
	return { account: locals.account, linkOnly: locals.actor?.source === 'link', units: getKinds(id), groupings: getGroupings(id), tagGroups: tagGroups(id) };
};
