import { redirect } from '@sveltejs/kit';
import { accountCount } from '$lib/server/auth';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.account) redirect(303, accountCount() === 0 ? '/setup' : '/login');
	return { account: locals.account };
};
