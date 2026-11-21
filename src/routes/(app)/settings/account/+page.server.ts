import { fail } from '@sveltejs/kit';
import { hash, verify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { account } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({ username: locals.account!.username });

export const actions: Actions = {
	password: async ({ request, locals }) => {
		const f = await request.formData();
		const current = String(f.get('current') ?? '');
		const next = String(f.get('next') ?? '');
		const row = db.select().from(account).where(eq(account.id, locals.account!.id)).get();
		if (!row || !(await verify(row.passwordHash, current)))
			return fail(400, { passwordError: 'Your current password is wrong.' });
		if (next.length < 8) return fail(400, { passwordError: 'Use at least 8 characters.' });
		db.update(account).set({ passwordHash: await hash(next) }).where(eq(account.id, row.id)).run();
		return { passwordSaved: true };
	}
};
