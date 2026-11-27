// Skipping days in bulk, two ways that share every step: skip_days skips every due day of the
// selected habits in a date range (a sick week); skip skips the days picked one by one (History).
// Each day goes through the same skip as Today and the Day page (core/log.ts), so streaks, the
// plan for today and the misses after it are worked out the same way. A range leaves days with
// something logged as they are. A routine's skip skips the habits inside it too: they are listed
// with their days, selected or not.
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { habit, occurrence } from '../db/schema';
import { history, pausesOf, scheduleAt } from '../today';
import { snapshot, type Snapshot } from '../backfill';
import { getSettings } from '../settings';
import { hasLog, logSkip } from '../core/log';
import { followDue } from '../rollup';
import { ActionError } from '../core/actor';
import type { HabitRow } from '../core/day';
import { addDays } from '$lib/engine/dates';
import { carriesOver, earliestLoggable } from '$lib/engine/backfill';
import { dueOn, isGroup, type Schedule } from '$lib/engine/schedule';
import { pauseOn, type Pause } from '$lib/engine/pause';
import { dayLabel, dayList, plural } from './report';
import type { Ctx, Run } from './types';

const PAST_DAYS = 'You can change how far back in Settings → Past days.';

/** Why none of a habit's days can be skipped, or null. */
function cantSkip(h: HabitRow): string | null {
	if (h.direction === 'break' || !h.schedule) return 'Break habits count slips, not days';
	if (isGroup(h.schedule as Schedule)) return "A group's days come from the habits inside it. Select those instead";
	if (h.archived) return 'Archived';
	return null;
}
const NO_FIXED_DAYS = 'It has no fixed days, so only a day it was due and missed can be skipped. Pause it instead';
const LOGGED = 'Something is logged on these days, so they stay as they are. Skip one on its day if you mean to';

type Outcome = 'skipped' | 'done' | 'already' | 'logged' | 'not_due' | { failed: string };

/** Days a routine's skip skipped in the habits inside it, by habit, with the routine's name. */
type Along = Map<string, { days: string[]; with: string }>;

/** Skip one day of a habit as Today does, recording how to undo it. `keepLogged`: a day with something logged stays. */
function skipDay({ actor, today, undo }: Ctx, h: HabitRow, d: string, pauses: Pause[], along: Along, keepLogged: boolean): Outcome {
	const occ = db.select().from(occurrence).where(and(eq(occurrence.habitId, h.id), eq(occurrence.date, d))).get();
	if (occ?.status === 'done') return 'done';
	if (occ?.status === 'skipped') return along.get(h.id)?.days.includes(d) ? 'skipped' : 'already';
	if (occ && keepLogged && hasLog(occ.id)) return 'logged';
	// A day whose phase carries over (a weekly target) has no fixed day to skip, like a whole habit that does.
	if (!occ && (pauseOn(pauses, h.id, d) || carriesOver(scheduleAt(h, d), d) || !dueOn(scheduleAt(h, d), history(h.id, d), d, followDue(h.id, scheduleAt(h, d), today)))) return 'not_due';
	const before = snapshot(h.id, d);
	try {
		logSkip(actor, { habit: h.id, date: d }, { keepLogged });
	} catch (e) {
		if (!(e instanceof ActionError)) throw e;
		return { failed: e.message };
	}
	const after = snapshot(h.id, d);
	undo.day(before, after);
	for (const id of newlySkipped(before, after)) {
		const a = along.get(id) ?? { days: [], with: h.name };
		a.days.push(d);
		along.set(id, a);
	}
	return 'skipped';
}

/** The habits inside a routine that its skip skipped. */
const newlySkipped = (before: Snapshot, after: Snapshot) =>
	(after.below ?? []).filter((a) => a.occ?.status === 'skipped' && before.below?.find((b) => b.habitId === a.habitId)?.occ?.status !== 'skipped').map((a) => a.habitId);

/** Habits before the habits inside them, so a routine's skip comes first and the habits it skipped are counted with it. */
function holdersFirst<T>(accountId: string, rows: T[], idOf: (r: T) => string): T[] {
	const parent = new Map(db.select({ id: habit.id, parentId: habit.parentId }).from(habit).where(eq(habit.accountId, accountId)).all().map((r) => [r.id, r.parentId]));
	const depth = (id: string) => {
		let n = 0;
		for (let p = parent.get(id); p && n < 20; p = parent.get(p)) n++;
		return n;
	};
	return [...rows].sort((a, b) => depth(idOf(a)) - depth(idOf(b)));
}

/** The habits a routine's skip skipped that weren't selected themselves: listed too, so the preview says all it does. */
function reportAlong(ctx: Ctx, along: Along, selected: Set<string>): number {
	const ids = [...along.keys()].filter((id) => !selected.has(id));
	if (!ids.length) return 0;
	const names = new Map(db.select({ id: habit.id, name: habit.name }).from(habit).where(inArray(habit.id, ids)).all().map((r) => [r.id, r.name]));
	let days = 0;
	for (const id of ids) {
		const a = along.get(id)!;
		days += a.days.length;
		ctx.report.change({ id, label: names.get(id) ?? '', detail: `${plural(a.days.length, 'day')}: ${dayList(a.days)}, with ${a.with}` });
	}
	return days;
}

/** The first day that can still be logged, or null when there is no limit. */
const earliestOf = (ctx: Ctx) => earliestLoggable(ctx.today, getSettings(ctx.actor.accountId).pastDays);

export const skipDays: Run<'skip_days'> = (ctx, habits, { from, to }) => {
	const { today, report } = ctx;
	if (to < from) throw new ActionError('invalid', 'The last day is before the first.');
	if (to > today) report.note("Days after today can't be skipped yet, so they're left out. Pause the habits for those days instead.");
	const earliest = earliestOf(ctx);
	const first = earliest && from < earliest ? earliest : from;
	const last = to < today ? to : today;
	if (first > from)
		report.note(first > last ? `These days are too far back to log. ${PAST_DAYS}` : `Days before ${dayLabel(first)} are too far back to log, so they're left out. ${PAST_DAYS}`);
	const pauses = pausesOf(ctx.actor.accountId);
	const along: Along = new Map();
	let days = 0;
	for (const h of holdersFirst(ctx.actor.accountId, habits, (h) => h.id)) {
		const line = { id: h.id, label: h.name };
		const refused = cantSkip(h);
		if (refused) {
			report.skip(refused, line);
			continue;
		}
		const skipped: string[] = [];
		const done: string[] = [];
		const logged: string[] = [];
		let already = 0;
		const failed = new Map<string, string[]>();
		// Day by day, oldest first: skipping one day can change what a rotation has due the next.
		for (let d = first > h.startDate ? first : h.startDate; d <= last; d = addDays(d, 1)) {
			const r = skipDay(ctx, h, d, pauses, along, true);
			if (r === 'skipped') skipped.push(d);
			else if (r === 'done') done.push(d);
			else if (r === 'logged') logged.push(d);
			else if (r === 'already') already++;
			else if (r !== 'not_due') failed.set(r.failed, [...(failed.get(r.failed) ?? []), d]);
		}
		days += skipped.length;
		if (skipped.length) report.change({ ...line, detail: `${plural(skipped.length, 'day')}: ${dayList(skipped)}` });
		if (done.length) report.skip('Already done on some of these days, which stay done', { ...line, detail: dayList(done) });
		if (logged.length) report.skip(LOGGED, { ...line, detail: dayList(logged) });
		for (const [reason, ds] of failed) report.skip(reason, { ...line, detail: dayList(ds) });
		if (!skipped.length && !done.length && !logged.length && !failed.size)
			report.skip(already ? 'Already skipped' : carriesOver(h.schedule as Schedule) ? NO_FIXED_DAYS : 'Nothing was due on these days', line);
	}
	days += reportAlong(ctx, along, new Set(habits.map((h) => h.id)));
	report.summary(days ? `Skipped ${plural(days, 'day')} of ${plural(report.count, 'habit')}` : 'Nothing to skip');
};

/** Days picked one by one: each is skipped, or listed with why it can't be. */
export const skipPicked: Run<'skip'> = (ctx, picked) => {
	const { today, report } = ctx;
	const earliest = earliestOf(ctx);
	const pauses = pausesOf(ctx.actor.accountId);
	const along: Along = new Map();
	const habits = new Set<string>();
	let days = 0;
	for (const { id, habit: h, date: d } of holdersFirst(ctx.actor.accountId, picked, (r) => r.habit.id)) {
		const line = { id, label: h.name, detail: dayLabel(d) };
		const refused =
			cantSkip(h) ??
			(d > today
				? "Days after today can't be skipped yet. Pause the habit for them instead"
				: earliest && d < earliest
					? `Too far back to log. ${PAST_DAYS}`
					: d < h.startDate
						? 'Before the habit started'
						: null);
		if (refused) {
			report.skip(refused, line);
			continue;
		}
		const r = skipDay(ctx, h, d, pauses, along, false);
		if (r === 'skipped') {
			report.change(line);
			habits.add(h.id);
			days++;
		} else
			report.skip(
				r === 'done'
					? 'Done, and it stays done. Undo it on its day first to skip it'
					: r === 'already'
						? 'Already skipped'
						: r === 'not_due'
							? carriesOver(h.schedule as Schedule) ? NO_FIXED_DAYS : 'Nothing was due that day'
							: r === 'logged'
								? LOGGED
								: r.failed,
				line
			);
	}
	const picks = new Set(picked.map((p) => p.habit.id));
	for (const id of along.keys()) if (!picks.has(id)) habits.add(id);
	days += reportAlong(ctx, along, picks);
	report.summary(days ? `Skipped ${plural(days, 'day')} of ${plural(habits.size, 'habit')}` : 'Nothing to skip');
};
