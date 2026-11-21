// Log a past day: mark build habits done or skipped after the fact, open the full log,
// and add or remove slips. Every change can be undone from the toast.
import { randomUUID } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { habit, occurrence, slip } from '$lib/server/db/schema';
import { ownedHabit } from '$lib/server/owned';
import { quickDone, recount, sameAsLast, userToday } from '$lib/server/today';
import {
	clearDay,
	loadDay,
	occurrenceOn,
	planOfToday,
	replanToday,
	restore,
	snapshot,
	startFrom,
	unloggedOn,
	windowFor
} from '$lib/server/backfill';
import { getSettings } from '$lib/server/settings';
import { addDays } from '$lib/engine/dates';
import { earliestLoggable, isRealDate } from '$lib/engine/backfill';
import type { Level } from '$lib/engine/streak';
import type { ScheduleForm } from '$lib/forms';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, cookies }) => {
	const accountId = locals.account!.id;
	const today = userToday(accountId, cookies.get('tz'));
	const date = params.date;
	if (!isRealDate(date)) error(404, 'Not a date');
	if (date >= today) redirect(303, '/');
	const settings = getSettings(accountId);
	return {
		date,
		today,
		window: windowFor(accountId, date, today),
		pastDays: settings.pastDays,
		earliest: earliestLoggable(today, settings.pastDays),
		...loadDay(accountId, date, today),
		// The day before, for the "previous day" link: still worth a look if it has gaps.
		prevUnlogged: unloggedOn(accountId, addDays(date, -1)).length
	};
};

const field = (f: FormData, k: string) => String(f.get(k) ?? '');
const levelOf = (f: FormData): Level | null => {
	const v = field(f, 'level');
	return v === 'minimum' || v === 'stretch' || v === 'target' ? v : null;
};

/**
 * Run a change to one build habit on this day: check the habit and the date, keep a copy
 * for Undo, then plan today again in case the change moved the schedule. Answers with
 * what to say in the toast and the copy to undo it with.
 */
async function change(
	{ request, locals, params, cookies }: Parameters<Actions[string]>[0],
	verb: string,
	run: (ctx: { h: NonNullable<ReturnType<typeof ownedHabit>>; f: FormData; today: string; schedule: ScheduleForm }) =>
		| 'done'
		| 'needsInput'
		| 'gone'
		| void
) {
	const accountId = locals.account!.id;
	const f = await request.formData();
	const date = params.date!;
	const today = userToday(accountId, cookies.get('tz'));
	const h = ownedHabit(accountId, field(f, 'habit'));
	if (!h || h.direction !== 'build' || !h.schedule || !isRealDate(date)) error(404);
	const w = windowFor(accountId, date, today);
	if (w !== 'ok')
		return fail(400, {
			habit: h.id,
			error:
				w === 'off'
					? 'Logging past days is off in Settings.'
					: w === 'tooOld'
						? 'This day is too far back to log. You can change how far back in Settings.'
						: 'Log today on Today.'
		});
	if (date < h.startDate) return fail(400, { habit: h.id, error: `${h.name} started on ${h.startDate}.` });
	const schedule = h.schedule as ScheduleForm;
	const before = planOfToday(h.id, schedule, today);
	const undo = snapshot(h.id, date);
	const r = run({ h, f, today, schedule });
	replanToday(accountId, h.id, schedule, today, before);
	recount(accountId, h.id, schedule, date, today);
	if (r === 'gone') return fail(400, { habit: h.id, error: `${h.name} has nothing to log.` });
	if (r === 'needsInput') {
		// A required field is still empty: ask for it on the quick log.
		const occ = db
			.select({ id: occurrence.id })
			.from(occurrence)
			.where(and(eq(occurrence.habitId, h.id), eq(occurrence.date, date)))
			.get();
		if (occ) redirect(303, `/log/${occ.id}?quick&back=${encodeURIComponent(`/day/${date}`)}`);
	}
	return { did: { habit: h.name, verb, undo: JSON.stringify(undo) } };
}

/** The Occurrence to act on: this habit on this day, with the Variant picked on the page. */
const occOf = (event: Parameters<Actions[string]>[0], h: NonNullable<ReturnType<typeof ownedHabit>>, f: FormData) =>
	occurrenceOn(event.locals.account!.id, h, event.params.date!, field(f, 'variant') || null);

export const actions: Actions = {
	/** One tap: done. Logs the targets (at a level) when the habit has Tasks. */
	done: (event) =>
		change(event, 'Logged', ({ h, f }) => {
			const occ = occOf(event, h, f);
			if (!occ) return 'gone';
			const level = levelOf(f);
			if (field(f, 'slots') !== '0') return quickDone(occ.id, level);
			db.update(occurrence)
				.set({ status: 'done', finishedAt: new Date(), level: level === 'target' ? null : level })
				.where(eq(occurrence.id, occ.id))
				.run();
			return 'done';
		}),
	/** Copy the last log from before this day and finish. */
	same: (event) =>
		change(event, 'Logged', ({ h, f }) => {
			const occ = occOf(event, h, f);
			return occ ? sameAsLast(occ.id) : 'gone';
		}),
	skip: (event) =>
		change(event, 'Skipped', ({ h, f }) => {
			const occ = occOf(event, h, f);
			if (!occ) return 'gone';
			db.update(occurrence).set({ status: 'skipped', finishedAt: null, level: null }).where(eq(occurrence.id, occ.id)).run();
		}),
	/** Open the full log for this day. */
	open: (event) =>
		change(event, '', ({ h, f }) => {
			const occ = occOf(event, h, f);
			if (occ) redirect(303, `/log/${occ.id}?back=${encodeURIComponent(`/day/${event.params.date}`)}`);
			return 'gone';
		}),
	/** Take the log away: back to missed if it was due that day. */
	clear: (event) =>
		change(event, 'Cleared', ({ h, today, schedule }) =>
			clearDay(event.locals.account!.id, h.id, schedule, event.params.date!, today)
		),
	/** Undo: put the day back as it was. */
	restore: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		let snap: unknown;
		try {
			snap = JSON.parse(field(f, 'snapshot'));
		} catch {
			return fail(400, { error: 'Could not undo.' });
		}
		const accountId = locals.account!.id;
		const habitId = (snap as { habitId?: string })?.habitId ?? '';
		const h = ownedHabit(accountId, habitId);
		if (!h?.schedule) return fail(400, { error: 'Could not undo.' });
		const today = userToday(accountId, cookies.get('tz'));
		const before = planOfToday(h.id, h.schedule as ScheduleForm, today);
		if (!restore(accountId, snap)) return fail(400, { error: 'Could not undo.' });
		replanToday(accountId, h.id, h.schedule as ScheduleForm, today, before);
		const date = (snap as { date?: unknown }).date;
		if (typeof date === 'string') recount(accountId, h.id, h.schedule as ScheduleForm, date, today);
	},
	/** Start a habit from this day, for one that was set up later than it really began. */
	start: async ({ request, locals, params, cookies }) => {
		const f = await request.formData();
		const accountId = locals.account!.id;
		const h = ownedHabit(accountId, field(f, 'habit'));
		if (!h || !isRealDate(params.date)) error(404);
		const today = userToday(accountId, cookies.get('tz'));
		if (params.date >= today) return fail(400, { habit: h.id, error: 'Pick a day before today.' });
		if (h.direction === 'build' && windowFor(accountId, params.date, today) !== 'ok')
			return fail(400, { habit: h.id, error: 'This day is too far back to log. You can change how far back in Settings.' });
		startFrom(h, params.date);
		return { started: { habit: h.name } };
	},
	/** A slip on this day. Slips can always be added for a past day. */
	slip: async ({ request, locals, params }) => {
		const f = await request.formData();
		const h = ownedHabit(locals.account!.id, field(f, 'habit'));
		if (!h || h.direction !== 'break' || !isRealDate(params.date)) error(404);
		if (params.date < h.startDate) return fail(400, { habit: h.id, error: `${h.name} started on ${h.startDate}.` });
		const count = Number(field(f, 'count') || 1);
		if (!Number.isInteger(count) || count < 1 || count > 1000)
			return fail(400, { habit: h.id, error: 'Count must be a whole number from 1 to 1000.' });
		const time = field(f, 'time');
		const id = randomUUID();
		db.insert(slip)
			.values({
				id,
				habitId: h.id,
				date: params.date,
				count,
				notes: null,
				time: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null,
				place: null,
				feeling: field(f, 'feeling').trim().slice(0, 40) || null,
				withWhom: null
			})
			.run();
		return { slipped: { id, habit: h.name, limit: !!h.limit } };
	},
	unslip: async ({ request, locals }) => {
		const f = await request.formData();
		const row = db
			.select({ s: slip })
			.from(slip)
			.innerJoin(habit, eq(slip.habitId, habit.id))
			.where(and(eq(slip.id, field(f, 'id')), eq(habit.accountId, locals.account!.id)))
			.get();
		if (!row) return;
		db.delete(slip).where(eq(slip.id, row.s.id)).run();
		// Sent back so Undo can put it back exactly.
		return { unslipped: { ...row.s, createdAt: row.s.createdAt.getTime() } };
	},
	/** Undo removing a slip. */
	reslip: async ({ request, locals }) => {
		const f = await request.formData();
		let s: Record<string, unknown>;
		try {
			s = JSON.parse(field(f, 'slip'));
		} catch {
			return fail(400, { error: 'Could not undo.' });
		}
		const h = ownedHabit(locals.account!.id, String(s.habitId ?? ''));
		const str = (v: unknown, n: number) => (typeof v === 'string' && v ? v.slice(0, n) : null);
		if (!h || h.direction !== 'break' || typeof s.date !== 'string' || !isRealDate(s.date) || typeof s.count !== 'number')
			return fail(400, { error: 'Could not undo.' });
		db.insert(slip)
			.values({
				id: randomUUID(),
				habitId: h.id,
				date: s.date,
				count: Math.max(1, Math.min(1000, Math.round(s.count))),
				notes: str(s.notes, 5000),
				time: str(s.time, 5),
				place: str(s.place, 120),
				feeling: str(s.feeling, 40),
				withWhom: str(s.withWhom, 120),
				createdAt: typeof s.createdAt === 'number' ? new Date(s.createdAt) : new Date()
			})
			.run();
	}
};
