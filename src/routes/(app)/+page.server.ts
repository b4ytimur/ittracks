import { keepGoals, stepsOf } from '$lib/server/progress';
import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { entry, habit, occurrence, prepTick, slot, variant } from '$lib/server/db/schema';
import { createOccurrence, loadPrep, loadToday, timeIn, userToday } from '$lib/server/today';
import { raise } from '$lib/engine/progression';
import { addDays } from '$lib/engine/dates';
import { getPacks, getSettings, getViews, saveSettings } from '$lib/server/settings';
import { startHabit, unstart } from '$lib/server/start';
import { takeFlash } from '$lib/server/flash';
import { listHabits } from '$lib/server/repo/habits';
import { PAGE_PATH, isHidden } from '$lib/views';
import { getDayNote } from '$lib/server/journal';
import { listAreas } from '$lib/server/repo/areas';
import type { Level } from '$lib/engine/streak';
import { ownedHabit, ownedOccurrence } from '$lib/server/owned';
import { headlineTexts } from '$lib/server/stats';
import { unloggedOn } from '$lib/server/backfill';
import { logWindow } from '$lib/engine/backfill';
import { ActionError, appActor } from '$lib/server/core/actor';
import { undoRoutine, withRoutineUndo } from '$lib/server/routine-day';
import { addSlip, doneOcc, plusOcc, removeCraving, removeSlip, reopenOcc, resistCraving, skipOcc } from '$lib/server/core/log';
import type { Actions, PageServerLoad } from './$types';

/** The signed-in person, as the core's actions and the event log see them. */
const actorOf = (locals: App.Locals, cookies: { get: (k: string) => string | undefined }) => appActor(locals.account!.id, cookies.get('tz'));
/** Taking back something already gone is not an error worth showing. */
const quietly = (run: () => unknown) => {
	try {
		run();
	} catch (e) {
		if (!(e instanceof ActionError)) throw e;
	}
};

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
		// Asked the first time it matters: after midnight, before most days start, with something to log.
		askDay: settings.dayStart === undefined && timeIn(tz || settings.timeZone) < LATE && listHabits(accountId).length > 0,
		packs: getPacks(accountId),
		habitCount: listHabits(accountId).length,
		hints: settings.hints ?? [],
		/** What a quick link just did. */
		flash: takeFlash(cookies),
		views,
		ranges: settings.ranges,
		areas: listAreas(accountId),
		/** J3: the day note, when it is on (Settings) and the Journal feature is too. */
		dayNote: settings.dayNote && !isHidden(views, 'journal') ? getDayNote(accountId, today) : null
	};
};

/** Before this, "today" may still be yesterday for someone. */
const LATE = '05:00';

const field = (f: FormData, k: string) => String(f.get(k) ?? '');
const levelOf = (f: FormData): Level | null => {
	const v = field(f, 'level');
	return v === 'minimum' || v === 'stretch' || v === 'target' ? v : null;
};
const clip = (v: string, n = 120) => v.trim().slice(0, n) || null;

/**
 * What a Done from Today ended as. A log that falls short of the habit's rule stays open, and
 * the toast says why instead of celebrating.
 */
function ended(o: { occ: { id: string }; habit: { id: string; name: string; minimumCounts: boolean } }, clear: boolean, undo?: string) {
	const status = db.select({ status: occurrence.status }).from(occurrence).where(eq(occurrence.id, o.occ.id)).get()?.status;
	const short = status === 'due' ? (o.habit.minimumCounts ? 'minimum' : 'target') : undefined;
	return { finished: status === 'done' ? o.habit.id : null, did: { occurrence: o.occ.id, habit: o.habit.name, clear, short, undo } };
}

export const actions: Actions = {
	/** Mark a habit with nothing to log as done, straight from Today. */
	done: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const o = ownedOccurrence(locals.account!.id, field(f, 'occurrence'));
		if (!o) error(404);
		const { undo } = withRoutineUndo(o.occ, () => doneOcc(actorOf(locals, cookies), o.occ, 'mark', levelOf(f)));
		return ended(o, false, undo);
	},
	/** One tap: done at a level, logging that level's Slot targets. */
	quick: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const o = ownedOccurrence(locals.account!.id, field(f, 'occurrence'));
		if (!o) error(404);
		if (doneOcc(actorOf(locals, cookies), o.occ, 'targets', levelOf(f)) === 'needsInput') redirect(303, `/log/${o.occ.id}?quick`);
		return ended(o, true);
	},
	/** +1 toward a habit's one target ("3 of 6 glasses"), or by=-1 to take a tap back. Reaching the target finishes it. */
	plus: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const o = ownedOccurrence(locals.account!.id, field(f, 'occurrence'));
		if (!o) error(404);
		const by = field(f, 'by') === '-1' ? -1 : 1;
		const r = plusOcc(actorOf(locals, cookies), o.occ, by);
		if (!r) return fail(400, { error: `${o.habit.name} has no single number to count.` });
		return {
			plus: { occurrence: o.occ.id, habit: o.habit.name, by, ...r },
			...(r.done && by > 0 && o.occ.status !== 'done' ? { finished: o.habit.id } : {})
		};
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
			const variants = tx.select({ id: variant.id }).from(variant).where(and(eq(variant.habitId, h.id), eq(variant.archived, false))).all();
			// Logs before the raise keep the targets they aimed for.
			keepGoals(tx, variants.map((v) => v.id));
			for (const v of variants)
				for (const s of tx.select().from(slot).where(eq(slot.variantId, v.id)).all()) {
					// By steps, each target rises by its own field's step: 2.5 kg, 1 rep.
					const steps = stepsOf([...Object.keys(s.targets ?? {}), ...Object.keys(s.stretchTargets ?? {})], tx);
					tx.update(slot)
						.set({
							targets: s.targets ? raise(s.targets, p, steps) : s.targets,
							stretchTargets: s.stretchTargets ? raise(s.stretchTargets, p, steps) : s.stretchTargets
						})
						.where(eq(slot.id, s.id))
						.run();
				}
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
	same: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const o = ownedOccurrence(locals.account!.id, field(f, 'occurrence'));
		if (!o) error(404);
		// Same as last keeps what was already logged, so Undo must not clear it.
		const started = !!db.select({ id: entry.id }).from(entry).where(eq(entry.occurrenceId, o.occ.id)).get();
		if (o.occ.status === 'due' && doneOcc(actorOf(locals, cookies), o.occ, 'same', null) === 'needsInput') redirect(303, `/log/${o.occ.id}?quick`);
		return ended(o, !started);
	},
	skip: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const o = ownedOccurrence(locals.account!.id, field(f, 'occurrence'));
		if (!o) error(404);
		const { undo } = withRoutineUndo(o.occ, () => skipOcc(actorOf(locals, cookies), o.occ));
		return { did: { occurrence: o.occ.id, habit: o.habit.name, clear: false, skipped: true, undo } };
	},
	/** Back to due. `clear` also removes what a one-tap log wrote. */
	undo: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const o = ownedOccurrence(locals.account!.id, field(f, 'occurrence'));
		if (!o) error(404);
		const undo = field(f, 'undo');
		if (undo) return undoRoutine(actorOf(locals, cookies), o.occ, undo) ? undefined : fail(400, { error: 'Could not undo.' });
		reopenOcc(actorOf(locals, cookies), o.occ, field(f, 'clear') === '1');
	},
	/** A habit from the sentence it was said in. */
	start: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		let said: unknown;
		try {
			said = JSON.parse(field(f, 'said'));
		} catch {
			return fail(400, { error: 'Say what you want to track.' });
		}
		const r = startHabit(locals.account!.id, said, userToday(locals.account!.id, cookies.get('tz')));
		return 'error' in r ? fail(400, { error: r.error }) : { started: r };
	},
	unstart: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const ok = unstart(locals.account!.id, field(f, 'habit'), field(f, 'task') || null, userToday(locals.account!.id, cookies.get('tz')));
		return ok ? undefined : fail(404, { error: 'It is already gone.' });
	},
	/** Start a rotation's next Variant today, ahead of its rest days. */
	early: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const h = ownedHabit(locals.account!.id, field(f, 'habit'));
		const v = db
			.select()
			.from(variant)
			.where(and(eq(variant.id, field(f, 'variant')), eq(variant.habitId, h?.id ?? ''), eq(variant.archived, false)))
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
		const { slipId: id } = addSlip(
			actorOf(locals, cookies),
			{
				habit: h.id,
				date,
				count,
				notes: field(f, 'notes') || null,
				time: /^\d{2}:\d{2}$/.test(clockTime) ? clockTime : null,
				place: clip(field(f, 'place')),
				feeling: clip(field(f, 'feeling'), 40),
				withWhom: clip(field(f, 'withWhom'))
			},
			{ stampNow: false }
		);
		return { slipped: { id, habit: h.name } };
	},
	unslip: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		quietly(() => removeSlip(actorOf(locals, cookies), field(f, 'id')));
	},
	uncraving: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		quietly(() => removeCraving(actorOf(locals, cookies), field(f, 'id')));
	},
	/** A craving resisted, usually by doing the if-then replacement. */
	craving: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const h = ownedHabit(locals.account!.id, field(f, 'habit'));
		if (!h || h.direction !== 'break') error(404);
		const { cravingId: id } = resistCraving(actorOf(locals, cookies), { habit: h.id, time: timeIn(cookies.get('tz')) });
		return { resisted: h.id, cravingId: id };
	}
};
