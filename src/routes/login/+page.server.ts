import { fail, redirect } from '@sveltejs/kit';
import { accountCount, checkPassword, startSession } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (accountCount() === 0) redirect(303, '/setup');
	if (locals.account) redirect(303, '/');
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const username = String(form.get('username') ?? '').trim();
		const id = await checkPassword(username, String(form.get('password') ?? ''));
		if (!id) return fail(400, { error: 'Wrong username or password.', field: 'password', username });
		startSession(id, cookies, url.protocol === 'https:');
		redirect(303, '/');
	}
};
