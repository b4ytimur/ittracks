import { fail } from '@sveltejs/kit';
import { userToday } from '$lib/server/today';
import {
	addIdentity,
	deleteIdentity,
	identityVotes,
	renameIdentity
} from '$lib/server/repo/identities';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, cookies }) => ({
	identities: identityVotes(locals.account!.id, userToday(locals.account!.id, cookies.get('tz')))
});

const statementOf = (f: FormData) => String(f.get('statement') ?? '').trim().slice(0, 120);

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const statement = statementOf(await request.formData());
		if (!statement) return fail(400, { error: 'Write the identity as a sentence, like "I am a runner".' });
		addIdentity(locals.account!.id, statement);
	},
	rename: async ({ request, locals }) => {
		const f = await request.formData();
		const statement = statementOf(f);
		if (!statement) return fail(400, { error: 'An identity needs a sentence.' });
		renameIdentity(locals.account!.id, String(f.get('id')), statement);
	},
	delete: async ({ request, locals }) => {
		deleteIdentity(locals.account!.id, String((await request.formData()).get('id')));
	}
};
