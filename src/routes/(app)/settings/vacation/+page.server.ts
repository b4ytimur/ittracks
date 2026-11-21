import { fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '$lib/server/db';
import { pause } from '$lib/server/db/schema';
import { listVacations } from '$lib/server/repo/vacations';
import { repaused, userToday } from '$lib/server/today';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, cookies }) => {
	const accountId = locals.account!.id;
	return { today: userToday(accountId, cookies.get('tz')), vacations: listVacations(accountId) };
};

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export const actions: Actions = {
	/** A vacation pauses every habit for a date range. */
	vacation: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const start = String(f.get('start') ?? '');
		const end = String(f.get('end') ?? '');
		if (!isDate(start) || !isDate(end) || end < start) return fail(400, { vacationError: 'Pick a start and an end date.' });
		db.insert(pause)
			.values({ id: randomUUID(), accountId: locals.account!.id, habitId: null, start, end, note: String(f.get('note') ?? '').slice(0, 120) || null })
			.run();
		// A vacation over past days takes back the misses counted for them.
		repaused(locals.account!.id, null, start, end, userToday(locals.account!.id, cookies.get('tz')));
		return { vacationSaved: true };
	},
	unvacation: async ({ request, locals, cookies }) => {
		const id = String((await request.formData()).get('id') ?? '');
		const where = and(eq(pause.id, id), eq(pause.accountId, locals.account!.id));
		const p = db.select().from(pause).where(where).get();
		if (!p) return;
		db.delete(pause).where(where).run();
		repaused(locals.account!.id, null, p.start, p.end, userToday(locals.account!.id, cookies.get('tz')));
	}
};
