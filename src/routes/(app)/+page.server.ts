import { randomUUID } from 'node:crypto';
import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { craving, occurrence, slip, variant } from '$lib/server/db/schema';
import { createOccurrence, loadToday, quickDone, timeIn, todayIn } from '$lib/server/today';
import { getSettings, saveSettings } from '$lib/server/settings';
import type { Level } from '$lib/engine/streak';
import { ownedHabit, ownedOccurrence } from '$lib/server/owned';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, cookies }) => {
	const accountId = locals.account!.id;
	const tz = cookies.get('tz');
	// Reminders run on the server, so it needs to know the user's time zone.
	if (tz && getSettings(accountId).timeZone !== tz) saveSettings(accountId, { timeZone: tz });
	const today = todayIn(tz);
	return { today, ...loadToday(accountId, today) };
};

const field = (f: FormData, k: string) => String(f.get(k) ?? '');
const levelOf = (f: FormData): Level | null => {
	const v = field(f, 'level');
	return v === 'minimum' || v === 'stretch' || v === 'target' ? v : null;
};
const clip = (v: string, n = 120) => v.trim().slice(0, n) || null;

export const actions: Actions = {
	/** Mark a habit with nothing to log as done, straight from Today. */
	done: async ({ request, locals }) => {
		const f = await request.formData();
		const o = ownedOccurrence(locals.account!.id, field(f, 'occurrence'));
		if (!o) error(404);
		const level = levelOf(f);
		db.update(occurrence)
			.set({ status: 'done', finishedAt: new Date(), level: level === 'target' ? null : level })
			.where(eq(occurrence.id, o.occ.id))
			.run();
	},
	/** One tap: done at a level, logging that level's Slot targets. */
	quick: async ({ request, locals }) => {
		const f = await request.formData();
		const o = ownedOccurrence(locals.account!.id, field(f, 'occurrence'));
		if (!o) error(404);
		quickDone(o.occ.id, levelOf(f));
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
			.set({ status: 'due', finishedAt: null, level: null })
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
		const time = field(f, 'time');
		db.insert(slip)
			.values({
				id: randomUUID(),
				habitId: h.id,
				date,
				count,
				notes: field(f, 'notes') || null,
				time: /^\d{2}:\d{2}$/.test(time) ? time : null,
				place: clip(field(f, 'place')),
				feeling: clip(field(f, 'feeling'), 40),
				withWhom: clip(field(f, 'withWhom'))
			})
			.run();
	},
	/** A craving resisted, usually by doing the if-then replacement. */
	craving: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const h = ownedHabit(locals.account!.id, field(f, 'habit'));
		if (!h || h.direction !== 'break') error(404);
		db.insert(craving)
			.values({ id: randomUUID(), habitId: h.id, date: todayIn(cookies.get('tz')), time: timeIn(cookies.get('tz')) })
			.run();
		return { resisted: h.id };
	}
};
