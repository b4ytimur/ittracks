import { randomUUID } from 'node:crypto';
import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { craving, habit, occurrence, prepTick, slip, slot, variant } from '$lib/server/db/schema';
import { createOccurrence, loadPrep, loadToday, quickDone, timeIn, todayIn } from '$lib/server/today';
import { raise } from '$lib/engine/progression';
import { addDays } from '$lib/engine/dates';
import { getSettings, saveSettings } from '$lib/server/settings';
import type { Level } from '$lib/engine/streak';
import { ownedHabit, ownedOccurrence } from '$lib/server/owned';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, cookies, url }) => {
	const accountId = locals.account!.id;
	const tz = cookies.get('tz');
	// Reminders run on the server, so it needs to know the user's time zone.
	if (tz && getSettings(accountId).timeZone !== tz) saveSettings(accountId, { timeZone: tz });
	const today = todayIn(tz);
	// The Log screen sends you back here after Finish, so the reward can show.
	return { today, finished: url.searchParams.get('finished'), prep: loadPrep(accountId, today), ...loadToday(accountId, today) };
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
		return { finished: o.habit.id };
	},
	/** One tap: done at a level, logging that level's Slot targets. */
	quick: async ({ request, locals }) => {
		const f = await request.formData();
		const o = ownedOccurrence(locals.account!.id, field(f, 'occurrence'));
		if (!o) error(404);
		quickDone(o.occ.id, levelOf(f));
		return { finished: o.habit.id };
	},
	/** Tick or untick a prep step for tomorrow's Occurrence. */
	prep: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const h = ownedHabit(locals.account!.id, field(f, 'habit'));
		const item = field(f, 'item');
		if (!h || !h.prep?.includes(item)) error(404);
		const date = addDays(todayIn(cookies.get('tz')), 1);
		const where = and(eq(prepTick.habitId, h.id), eq(prepTick.date, date), eq(prepTick.item, item));
		if (field(f, 'done') === 'true') db.insert(prepTick).values({ habitId: h.id, date, item }).onConflictDoNothing().run();
		else db.delete(prepTick).where(where).run();
	},
	/** Accept a progression suggestion: raise Target and Stretch in every Slot. */
	raise: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const h = ownedHabit(locals.account!.id, field(f, 'habit'));
		if (!h?.progression) error(404);
		const p = h.progression;
		const today = todayIn(cookies.get('tz'));
		db.transaction((tx) => {
			const variants = tx.select({ id: variant.id }).from(variant).where(eq(variant.habitId, h.id)).all();
			for (const v of variants)
				for (const s of tx.select().from(slot).where(eq(slot.variantId, v.id)).all())
					tx.update(slot)
						.set({
							targets: s.targets ? raise(s.targets, p) : s.targets,
							stretchTargets: s.stretchTargets ? raise(s.stretchTargets, p) : s.stretchTargets
						})
						.where(eq(slot.id, s.id))
						.run();
			tx.update(habit).set({ progressionFrom: today }).where(eq(habit.id, h.id)).run();
		});
		return { raised: h.id };
	},
	/** Not yet: start counting again from today. */
	notYet: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const h = ownedHabit(locals.account!.id, field(f, 'habit'));
		if (!h) error(404);
		db.update(habit).set({ progressionFrom: todayIn(cookies.get('tz')) }).where(eq(habit.id, h.id)).run();
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
