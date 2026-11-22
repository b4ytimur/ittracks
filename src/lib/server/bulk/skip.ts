// Skipping days in bulk, two ways that share every step: skip_days skips every due day of the
// selected habits in a date range (a sick week); skip skips the days picked one by one (History).
// Each day goes through the same skip as Today and the Day page (core/log.ts), so streaks, the
// plan for today and the misses after it are worked out the same way.
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { occurrence } from '../db/schema';
import { history, pausesOf, scheduleAt } from '../today';
import { snapshot } from '../backfill';
import { getSettings } from '../settings';
import { logSkip } from '../core/log';
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
	if (carriesOver(h.schedule as Schedule)) return 'It has no fixed days, so no day counts as missed. Pause it instead';
	return null;
}

type Outcome = 'skipped' | 'done' | 'already' | 'not_due' | { failed: string };

/** Skip one day of a habit as Today does, recording how to undo it. */
function skipDay({ actor, today, undo }: Ctx, h: HabitRow, d: string, pauses: Pause[]): Outcome {
	const occ = db.select().from(occurrence).where(and(eq(occurrence.habitId, h.id), eq(occurrence.date, d))).get();
	if (occ?.status === 'done') return 'done';
	if (occ?.status === 'skipped') return 'already';
	// A day whose phase carries over (a weekly target) has no fixed day to skip, like a whole habit that does.
	if (!occ && (pauseOn(pauses, h.id, d) || carriesOver(scheduleAt(h, d), d) || !dueOn(scheduleAt(h, d), history(h.id, d), d, followDue(h.id, scheduleAt(h, d), today)))) return 'not_due';
	const before = snapshot(h.id, d);
	try {
		logSkip(actor, { habit: h.id, date: d });
	} catch (e) {
		if (!(e instanceof ActionError)) throw e;
		return { failed: e.message };
	}
	undo.day(before, snapshot(h.id, d));
	return 'skipped';
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
	let days = 0;
	for (const h of habits) {
		const line = { id: h.id, label: h.name };
		const refused = cantSkip(h);
		if (refused) {
			report.skip(refused, line);
			continue;
		}
		const skipped: string[] = [];
		const done: string[] = [];
		let already = 0;
		const failed = new Map<string, string[]>();
		// Day by day, oldest first: skipping one day can change what a rotation has due the next.
		for (let d = first > h.startDate ? first : h.startDate; d <= last; d = addDays(d, 1)) {
			const r = skipDay(ctx, h, d, pauses);
			if (r === 'skipped') skipped.push(d);
			else if (r === 'done') done.push(d);
			else if (r === 'already') already++;
			else if (r !== 'not_due') failed.set(r.failed, [...(failed.get(r.failed) ?? []), d]);
		}
		days += skipped.length;
		if (skipped.length) report.change({ ...line, detail: `${plural(skipped.length, 'day')}: ${dayList(skipped)}` });
		if (done.length) report.skip('Already done on some of these days, which stay done', { ...line, detail: dayList(done) });
		for (const [reason, ds] of failed) report.skip(reason, { ...line, detail: dayList(ds) });
		if (!skipped.length && !done.length && !failed.size) report.skip(already ? 'Already skipped' : 'Nothing was due on these days', line);
	}
	report.summary(days ? `Skipped ${plural(days, 'day')} of ${plural(report.count, 'habit')}` : 'Nothing to skip');
};

/** Days picked one by one: each is skipped, or listed with why it can't be. */
export const skipPicked: Run<'skip'> = (ctx, picked) => {
	const { today, report } = ctx;
	const earliest = earliestOf(ctx);
	const pauses = pausesOf(ctx.actor.accountId);
	const habits = new Set<string>();
	for (const { id, habit: h, date: d } of picked) {
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
		const r = skipDay(ctx, h, d, pauses);
		if (r === 'skipped') {
			report.change(line);
			habits.add(h.id);
		} else
			report.skip(
				r === 'done' ? 'Done, and it stays done. Undo it on its day first to skip it' : r === 'already' ? 'Already skipped' : r === 'not_due' ? 'Nothing was due that day' : r.failed,
				line
			);
	}
	report.summary(report.count ? `Skipped ${plural(report.count, 'day')} of ${plural(habits.size, 'habit')}` : 'Nothing to skip');
};
