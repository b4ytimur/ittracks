// skip_days: skip every due day of the selected habits in a date range (a sick week). Each day
// goes through the same skip as Today and the Day page (core/log.ts), so streaks, the plan for
// today and the misses after it are worked out the same way.
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { occurrence } from '../db/schema';
import { history, pausesOf, scheduleAt } from '../today';
import { snapshot } from '../backfill';
import { getSettings } from '../settings';
import { logSkip } from '../core/log';
import { followDue } from '../rollup';
import { ActionError } from '../core/actor';
import { addDays } from '$lib/engine/dates';
import { carriesOver, earliestLoggable } from '$lib/engine/backfill';
import { dueOn, isGroup, type Schedule } from '$lib/engine/schedule';
import { pauseOn } from '$lib/engine/pause';
import { dayLabel, dayList, plural } from './report';
import type { Run } from './types';

export const skipDays: Run<'skip_days'> = ({ actor, today, undo, report }, habits, { from, to }) => {
	if (to < from) throw new ActionError('invalid', 'The last day is before the first.');
	if (to > today) report.note("Days after today can't be skipped yet, so they're left out. Pause the habits for those days instead.");
	const earliest = earliestLoggable(today, getSettings(actor.accountId).pastDays);
	const first = earliest && from < earliest ? earliest : from;
	const last = to < today ? to : today;
	if (first > from)
		report.note(
			first > last
				? 'These days are too far back to log. You can change how far back in Settings → Past days.'
				: `Days before ${dayLabel(first)} are too far back to log, so they're left out. You can change how far back in Settings → Past days.`
		);
	const pauses = pausesOf(actor.accountId);
	let days = 0;
	for (const h of habits) {
		const line = { id: h.id, label: h.name };
		if (h.direction === 'break' || !h.schedule) {
			report.skip('Break habits count slips, not days', line);
			continue;
		}
		if (isGroup(h.schedule as Schedule)) {
			report.skip("A group's days come from the habits inside it. Select those instead", line);
			continue;
		}
		if (h.archived) {
			report.skip('Archived', line);
			continue;
		}
		if (carriesOver(h.schedule as Schedule)) {
			report.skip('It has no fixed days, so no day counts as missed. Pause it instead', line);
			continue;
		}
		const skipped: string[] = [];
		const done: string[] = [];
		let already = 0;
		const failed = new Map<string, string[]>();
		// Day by day, oldest first: skipping one day can change what a rotation has due the next.
		for (let d = first > h.startDate ? first : h.startDate; d <= last; d = addDays(d, 1)) {
			const occ = db.select().from(occurrence).where(and(eq(occurrence.habitId, h.id), eq(occurrence.date, d))).get();
			if (occ?.status === 'done') {
				done.push(d);
				continue;
			}
			if (occ?.status === 'skipped') {
				already++;
				continue;
			}
			// A day whose phase carries over has no fixed day to skip, like the whole habit above.
			if (!occ && (pauseOn(pauses, h.id, d) || carriesOver(scheduleAt(h, d), d) || !dueOn(scheduleAt(h, d), history(h.id, d), d, followDue(h.id, scheduleAt(h, d), today)))) continue;
			const before = snapshot(h.id, d);
			try {
				logSkip(actor, { habit: h.id, date: d });
			} catch (e) {
				if (!(e instanceof ActionError)) throw e;
				failed.set(e.message, [...(failed.get(e.message) ?? []), d]);
				continue;
			}
			undo.day(before, snapshot(h.id, d));
			skipped.push(d);
		}
		days += skipped.length;
		if (skipped.length) report.change({ ...line, detail: `${plural(skipped.length, 'day')}: ${dayList(skipped)}` });
		if (done.length) report.skip('Already done on some of these days, which stay done', { ...line, detail: dayList(done) });
		for (const [reason, ds] of failed) report.skip(reason, { ...line, detail: dayList(ds) });
		if (!skipped.length && !done.length && !failed.size) report.skip(already ? 'Already skipped' : 'Nothing was due on these days', line);
	}
	report.summary(days ? `Skipped ${plural(days, 'day')} of ${plural(report.count, 'habit')}` : 'Nothing to skip');
};
