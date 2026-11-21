import { randomUUID } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import { checkSettings } from '$lib/rules/settings';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { craving, entry, habit, occurrence, prepTick, slip, slot, variant } from '$lib/server/db/schema';
import { createOccurrence, loadPrep, loadToday, quickDone, reopen, sameAsLast, timeIn, userToday } from '$lib/server/today';
import { raise } from '$lib/engine/progression';
import { addDays } from '$lib/engine/dates';
import { getSettings, getViews, saveSettings } from '$lib/server/settings';
import { DEFAULT_TEMPLATE_NEW, PAGE_PATH, TEMPLATES, fromTemplate, isHidden, templateById } from '$lib/views';
import { getDayNote } from '$lib/server/journal';
import { listAreas } from '$lib/server/repo/areas';
import { DEFAULT_RANGES, duplicateRange, readRanges } from '$lib/engine/day';
import type { Level } from '$lib/engine/streak';
import { ownedHabit, ownedOccurrence } from '$lib/server/owned';
import { headlineTexts } from '$lib/server/stats';
import { unloggedOn } from '$lib/server/backfill';
import { logWindow } from '$lib/engine/backfill';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, cookies, url, request }) => {
	const accountId = locals.account!.id;
	const tz = cookies.get('tz');
	// Reminders run on the server, so it needs to know the user's time zone.
	const settings = getSettings(accountId);
	const views = getViews(accountId);
	// Opening the app (home screen icon, bookmark, typed address) goes to the chosen start page.
	// Links inside the app, like the Today tab, are same-origin and stay here.
	if (views.startPage !== 'today' && request.headers.get('sec-fetch-site') === 'none' && !url.search)
		redirect(303, PAGE_PATH[views.startPage]);
	if (tz && settings.timeZone !== tz) saveSettings(accountId, { timeZone: tz });
	const today = userToday(accountId, tz);
	const yesterday = addDays(today, -1);
	const loaded = loadToday(accountId, today);
	const canBackfill = logWindow(yesterday, today, settings.pastDays) === 'ok';
	return {
		today,
		...loaded,
		/** Number tiles picked on habit Stats tabs to show on Today. */
		headlines: headlineTexts(accountId, tz),
		/** Past days can be logged (Settings). */
		canBackfill,
		// Build habits due yesterday that were never logged, for the nudge. Checked after
		// loadToday, which settles yesterday first.
		unlogged: canBackfill && settings.nudgeYesterday ? unloggedOn(accountId, yesterday) : [],
		// The Log screen sends you back here after Finish, so the reward can show.
		finished: url.searchParams.get('finished'),
		prep: loadPrep(accountId, today),
		// Asked once: when the day starts, and its named parts.
		askDay: settings.dayStart === undefined,
		suggestedRanges: DEFAULT_RANGES,
		templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb })),
		suggestedTemplate: DEFAULT_TEMPLATE_NEW,
		views,
		ranges: settings.ranges,
		areas: listAreas(accountId),
		/** J3: the day note, when it is on (Settings) and the Journal feature is too. */
		dayNote: settings.dayNote && !isHidden(views, 'journal') ? getDayNote(accountId, today) : null
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
		return { finished: o.habit.id, did: { occurrence: o.occ.id, habit: o.habit.name, clear: false } };
	},
	/** One tap: done at a level, logging that level's Slot targets. */
	quick: async ({ request, locals }) => {
		const f = await request.formData();
		const o = ownedOccurrence(locals.account!.id, field(f, 'occurrence'));
		if (!o) error(404);
		if (quickDone(o.occ.id, levelOf(f)) === 'needsInput') redirect(303, `/log/${o.occ.id}?quick`);
		return { finished: o.habit.id, did: { occurrence: o.occ.id, habit: o.habit.name, clear: true } };
	},
	/** Tick or untick a prep step for tomorrow's Occurrence. */
	prep: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const h = ownedHabit(locals.account!.id, field(f, 'habit'));
		const item = field(f, 'item');
		if (!h || !h.prep?.includes(item)) error(404);
		const date = addDays(userToday(locals.account!.id, cookies.get('tz')), 1);
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
		const today = userToday(locals.account!.id, cookies.get('tz'));
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
		db.update(habit).set({ progressionFrom: userToday(locals.account!.id, cookies.get('tz')) }).where(eq(habit.id, h.id)).run();
	},
	/** Same as last time: copy the last log and finish. */
	same: async ({ request, locals }) => {
		const f = await request.formData();
		const o = ownedOccurrence(locals.account!.id, field(f, 'occurrence'));
		if (!o) error(404);
		// Same as last keeps what was already logged, so Undo must not clear it.
		const started = !!db.select({ id: entry.id }).from(entry).where(eq(entry.occurrenceId, o.occ.id)).get();
		if (o.occ.status === 'due' && sameAsLast(o.occ.id) === 'needsInput') redirect(303, `/log/${o.occ.id}?quick`);
		return { finished: o.habit.id, did: { occurrence: o.occ.id, habit: o.habit.name, clear: !started } };
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
		const twice = duplicateRange(f);
		if (twice) return fail(400, { error: `Two parts of the day are called “${twice}”. Give each its own name.` });
		const ranges = readRanges(f);
		const s = getSettings(locals.account!.id);
		const conflict = checkSettings({ ...s, dayStart, ranges })[0];
		if (conflict) return fail(400, { error: conflict.reason });
		// First run: the user also picked how much to see. Existing views are never replaced here.
		const tpl = templateById(field(f, 'template'));
		saveSettings(locals.account!.id, { dayStart, ranges, ...(tpl && !s.views ? { views: fromTemplate(tpl.id) } : {}) });
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
		const today = userToday(locals.account!.id, cookies.get('tz'));
		const date = field(f, 'date') || today;
		const count = Number(field(f, 'count') || 1);
		const real = /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
		if (!real || date > today || date < h.startDate)
			return fail(400, { habit: h.id, error: `Pick a date between ${h.startDate} and today.` });
		if (!Number.isInteger(count) || count < 1 || count > 1000)
			return fail(400, { habit: h.id, error: 'Count must be a whole number from 1 to 1000.' });
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
