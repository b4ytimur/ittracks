import { randomUUID } from 'node:crypto';
import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { craving, habit, occurrence, slip, variant } from '$lib/server/db/schema';
import { createOccurrence, loadToday, quickDone, reopen, sameAsLast, timeIn, userToday } from '$lib/server/today';
import { getSettings, saveSettings } from '$lib/server/settings';
import { listAreas } from '$lib/server/repo/areas';
import { DEFAULT_RANGES, readRanges } from '$lib/engine/day';
import type { Level } from '$lib/engine/streak';
import { ownedHabit, ownedOccurrence } from '$lib/server/owned';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, cookies }) => {
	const accountId = locals.account!.id;
	const tz = cookies.get('tz');
	// Reminders run on the server, so it needs to know the user's time zone.
	const settings = getSettings(accountId);
	if (tz && settings.timeZone !== tz) saveSettings(accountId, { timeZone: tz });
	const today = userToday(accountId, tz);
	return {
		today,
		...loadToday(accountId, today),
		// Asked once: when the day starts, and its named parts.
		askDay: settings.dayStart === undefined,
		suggestedRanges: DEFAULT_RANGES,
		groupByArea: settings.groupByArea,
		areas: settings.groupByArea ? listAreas(accountId) : []
	};
};

const time = /^([01]\d|2[0-3]):[0-5]\d$/;

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
		return { did: { occurrence: o.occ.id, habit: o.habit.name, clear: false } };
	},
	/** One tap: done at a level, logging that level's Slot targets. */
	quick: async ({ request, locals }) => {
		const f = await request.formData();
		const o = ownedOccurrence(locals.account!.id, field(f, 'occurrence'));
		if (!o) error(404);
		quickDone(o.occ.id, levelOf(f));
		return { did: { occurrence: o.occ.id, habit: o.habit.name, clear: true } };
	},
	/** Same as last time: copy the last log and finish. */
	same: async ({ request, locals }) => {
		const f = await request.formData();
		const o = ownedOccurrence(locals.account!.id, field(f, 'occurrence'));
		if (!o) error(404);
		if (o.occ.status === 'due') sameAsLast(o.occ.id);
		return { did: { occurrence: o.occ.id, habit: o.habit.name, clear: true } };
	},
	skip: async ({ request, locals }) => {
		const f = await request.formData();
		const o = ownedOccurrence(locals.account!.id, field(f, 'occurrence'));
		if (!o) error(404);
		db.update(occurrence).set({ status: 'skipped' }).where(eq(occurrence.id, o.occ.id)).run();
		return { did: { occurrence: o.occ.id, habit: o.habit.name, clear: false, skipped: true } };
	},
	/** Back to due. `clear` also removes what a one-tap log wrote. */
	undo: async ({ request, locals }) => {
		const f = await request.formData();
		const o = ownedOccurrence(locals.account!.id, field(f, 'occurrence'));
		if (!o) error(404);
		reopen(o.occ.id, field(f, 'clear') === '1');
	},
	/** Answer the one-time question: when does your day start, and what are its parts? */
	day: async ({ request, locals }) => {
		const f = await request.formData();
		const dayStart = field(f, 'dayStart');
		if (!time.test(dayStart)) return fail(400, { error: 'Pick a time like 04:00.' });
		saveSettings(locals.account!.id, { dayStart, ranges: readRanges(f) });
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
		createOccurrence(locals.account!.id, h.id, v.id, userToday(locals.account!.id, cookies.get('tz')));
	},
	slip: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const h = ownedHabit(locals.account!.id, field(f, 'habit'));
		if (!h || h.direction !== 'break') error(404);
		const date = field(f, 'date') || userToday(locals.account!.id, cookies.get('tz'));
		const count = Number(field(f, 'count') || 1);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(count > 0))
			return fail(400, { error: 'Check the date and count.' });
		const clockTime = field(f, 'time');
		const id = randomUUID();
		db.insert(slip)
			.values({
				id,
				habitId: h.id,
				date,
				count,
				notes: field(f, 'notes') || null,
				time: /^\d{2}:\d{2}$/.test(clockTime) ? clockTime : null,
				place: clip(field(f, 'place')),
				feeling: clip(field(f, 'feeling'), 40),
				withWhom: clip(field(f, 'withWhom'))
			})
			.run();
		return { slipped: { id, habit: h.name } };
	},
	unslip: async ({ request, locals }) => {
		const f = await request.formData();
		const row = db
			.select({ id: slip.id })
			.from(slip)
			.innerJoin(habit, eq(slip.habitId, habit.id))
			.where(and(eq(slip.id, field(f, 'id')), eq(habit.accountId, locals.account!.id)))
			.get();
		if (row) db.delete(slip).where(eq(slip.id, row.id)).run();
	},
	uncraving: async ({ request, locals }) => {
		const f = await request.formData();
		const row = db
			.select({ id: craving.id })
			.from(craving)
			.innerJoin(habit, eq(craving.habitId, habit.id))
			.where(and(eq(craving.id, field(f, 'id')), eq(habit.accountId, locals.account!.id)))
			.get();
		if (row) db.delete(craving).where(eq(craving.id, row.id)).run();
	},
	/** A craving resisted, usually by doing the if-then replacement. */
	craving: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const h = ownedHabit(locals.account!.id, field(f, 'habit'));
		if (!h || h.direction !== 'break') error(404);
		const id = randomUUID();
		db.insert(craving)
			.values({ id, habitId: h.id, date: userToday(locals.account!.id, cookies.get('tz')), time: timeIn(cookies.get('tz')) })
			.run();
		return { resisted: h.id, cravingId: id };
	}
};
