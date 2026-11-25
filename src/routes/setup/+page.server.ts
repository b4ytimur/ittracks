import { fail, redirect } from '@sveltejs/kit';
import { accountCount, createAccount, startSession } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

// First run only: create the single account for this Instance.
export const load: PageServerLoad = () => {
	if (accountCount() > 0) redirect(303, '/login');
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		if (accountCount() > 0) redirect(303, '/login');
		const form = await request.formData();
		const username = String(form.get('username') ?? '').trim();
		const password = String(form.get('password') ?? '');
		if (username.length < 1) return fail(400, { error: 'Choose a username.', field: 'username', username });
		if (password.length < 8)
			return fail(400, { error: 'Use a password of at least 8 characters.', field: 'password', username });
		const id = await createAccount(username, password);
		startSession(id, cookies, url.protocol === 'https:');
		redirect(303, '/');
	}
};
