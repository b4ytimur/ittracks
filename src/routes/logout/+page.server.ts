import { redirect } from '@sveltejs/kit';
import { endSession, SESSION_COOKIE } from '$lib/server/auth';
import type { Actions } from './$types';

export const actions: Actions = {
	default: ({ cookies }) => {
		endSession(cookies.get(SESSION_COOKIE), cookies);
		redirect(303, '/login');
	}
};
