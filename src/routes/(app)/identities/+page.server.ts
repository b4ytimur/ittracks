import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { userToday } from '$lib/server/today';
import {
	identityFor,
	listIdentities,
	orderIdentities,
	deleteIdentity,
	identityVotes,
	renameIdentity,
	restoreIdentity
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
		const before = new Set(listIdentities(locals.account!.id).map((i) => i.id));
		const id = identityFor(locals.account!.id, statement);
		// One that was there already is not new, so its Undo would delete it.
		return { added: before.has(id) ? null : id };
	},
	order: async ({ request, locals }) => {
		orderIdentities(locals.account!.id, String((await request.formData()).get('ids') ?? '').split(',').slice(0, 500));
	},
	rename: async ({ request, locals }) => {
		const f = await request.formData();
		const statement = statementOf(f);
		if (!statement) return fail(400, { error: 'An identity needs a sentence.' });
		// Another one says it already: refused as adding it is, so two never read the same.
		return { taken: !renameIdentity(locals.account!.id, String(f.get('id')), statement) };
	},
	delete: async ({ request, locals }) => {
		const deleted = deleteIdentity(locals.account!.id, String((await request.formData()).get('id')));
		return deleted ? { deleted } : fail(404, { error: 'No such identity' });
	},
	restore: async ({ request, locals }) => {
		const p = z
			.object({ id: z.string().uuid(), statement: z.string().min(1).max(120), sortOrder: z.number().int(), habitIds: z.array(z.string()).max(2000) })
			.safeParse(JSON.parse(String((await request.formData()).get('deleted'))));
		if (!p.success) return fail(400, { error: 'Not an identity' });
		restoreIdentity(locals.account!.id, p.data);
	}
};
