import { redirect } from '@sveltejs/kit';
import { accountCount } from '$lib/server/auth';
import { getKinds } from '$lib/server/settings';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.account) redirect(303, accountCount() === 0 ? '/setup' : '/login');
	// A quick-log link opened with a key shows its answer without the app around it.
	return { account: locals.account, linkOnly: locals.actor?.source === 'link', units: getKinds(locals.account.id) };
};
