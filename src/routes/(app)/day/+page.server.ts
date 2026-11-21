import { redirect } from '@sveltejs/kit';
import { addDays } from '$lib/engine/dates';
import { userToday } from '$lib/server/today';
import type { PageServerLoad } from './$types';

/** "Log a past day" starts at yesterday. */
export const load: PageServerLoad = ({ locals, cookies }) => {
	redirect(303, `/day/${addDays(userToday(locals.account!.id, cookies.get('tz')), -1)}`);
};
