import { randomUUID } from 'node:crypto';
import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { occurrence, slip, variant } from '$lib/server/db/schema';
import { createOccurrence, loadToday, todayIn } from '$lib/server/today';
import { ownedHabit, ownedOccurrence } from '$lib/server/owned';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, cookies }) => {
	const today = todayIn(cookies.get('tz'));
	return { today, ...loadToday(locals.account!.id, today) };
};

const field = (f: FormData, k: string) => String(f.get(k) ?? '');

export const actions: Actions = {
	/** Mark a habit with nothing to log as done, straight from Today. */
	done: async ({ request, locals }) => {
		const f = await request.formData();
		const o = ownedOccurrence(locals.account!.id, field(f, 'occurrence'));
		if (!o) error(404);
		db.update(occurrence)
			.set({ status: 'done', finishedAt: new Date() })
			.where(eq(occurrence.id, o.occ.id))
			.run();
	},
	skip: async ({ request, locals }) => {
		const f = await request.formData();
		const o = ownedOccurrence(locals.account!.id, field(f, 'occurrence'));
		if (!o) error(404);
		db.update(occurrence).set({ status: 'skipped' }).where(eq(occurrence.id, o.occ.id)).run();
	},
	undo: async ({ request, locals }) => {
		const f = await request.formData();
		const o = ownedOccurrence(locals.account!.id, field(f, 'occurrence'));
		if (!o) error(404);
		db.update(occurrence)
			.set({ status: 'due', finishedAt: null })
			.where(eq(occurrence.id, o.occ.id))
			.run();
	},
	/** Start a rotation's next Variant today, ahead of its rest days. */
	early: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const h = ownedHabit(locals.account!.id, field(f, 'habit'));
		const v = db
			.select()
			.from(variant)
			.where(and(eq(variant.id, field(f, 'variant')), eq(variant.habitId, h?.id ?? '')))
			.get();
		if (!h || !v) error(404);
		createOccurrence(locals.account!.id, h.id, v.id, todayIn(cookies.get('tz')));
	},
	slip: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const h = ownedHabit(locals.account!.id, field(f, 'habit'));
		if (!h || h.direction !== 'break') error(404);
		const date = field(f, 'date') || todayIn(cookies.get('tz'));
		const count = Number(field(f, 'count') || 1);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(count > 0))
			return fail(400, { error: 'Check the date and count.' });
		db.insert(slip)
			.values({ id: randomUUID(), habitId: h.id, date, count, notes: field(f, 'notes') || null })
			.run();
	}
};
