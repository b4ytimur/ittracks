import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { occurrence, slip } from '$lib/server/db/schema';
import { ownedHabit } from '$lib/server/owned';
import { pausesOf, settle, userToday } from '$lib/server/today';
import { missedDaysOver } from '$lib/engine/unlogged';
import { pauseOn } from '$lib/engine/pause';
import { isGroup, type Schedule } from '$lib/engine/schedule';
import type { ScheduleForm } from '$lib/forms';
import { getSettings } from '$lib/server/settings';
import { addDays, weekStart } from '$lib/engine/dates';
import { chainCells } from '$lib/engine/chain';
import { withinOn } from '$lib/engine/limit';
import { describeStreak, streak, type StreakRule } from '$lib/engine/streak';
import type { PageServerLoad } from './$types';

const WEEKS = 12;

export const load: PageServerLoad = ({ locals, params, cookies, url }) => {
	const h = ownedHabit(locals.account!.id, params.id);
	if (!h) error(404, 'Habit not found');
	const today = userToday(locals.account!.id, cookies.get('tz'));
	const weeks = Math.min(Math.max(Number(url.searchParams.get('weeks')) || WEEKS, 4), 104);
	const from = addDays(weekStart(today), -7 * (weeks - 1));
	const to = addDays(weekStart(today), 6);
	// Past days open the day page to log or change them; slips can always be added there.
	const canBackfill = h.direction === 'break' || getSettings(locals.account!.id).pastDays !== 0;

	if (h.direction === 'break') {
		const slips = db.select({ date: slip.date, count: slip.count }).from(slip).where(eq(slip.habitId, h.id)).all();
		const days = [];
		for (let d = from; d <= to; d = addDays(d, 1)) {
			const count = slips.filter((s) => s.date === d).reduce((n, s) => n + s.count, 0);
			// A day with slips is within the limit while the day's (or the week's, so far) total stays under it.
			const within = !!h.limit && withinOn(h.limit, slips, d);
			days.push({
				date: d,
				kind: d > today ? 'future' : d < h.startDate ? 'before' : count === 0 ? 'clean' : within ? 'within' : 'slip',
				count
			});
		}
		return { id: h.id, name: h.name, direction: h.direction, weeks, today, days, cells: [], summary: '', limit: !!h.limit, startDate: h.startDate, canBackfill };
	}

	const schedule = h.schedule as ScheduleForm | null;
	// Days nobody logged become misses first, as Today would do.
	if (schedule) settle(locals.account!.id, h.id, schedule, today);
	const marks = db
		.select({ date: occurrence.date, status: occurrence.status, level: occurrence.level, variantId: occurrence.variantId, extra: occurrence.extra })
		.from(occurrence)
		.where(eq(occurrence.habitId, h.id))
		.orderBy(asc(occurrence.date))
		.all();
	const rule = h.streakRule as StreakRule;
	// A habit that ignores unlogged days still shows them, as "not logged" rather than "not due".
	const pauses = pausesOf(locals.account!.id);
	const unlogged =
		h.unlogged === 'ignore' && schedule
			? new Set(
					missedDaysOver(schedule as Schedule, h.earlierSchedules, marks, h.startDate, from, addDays(today, -1), (d) => !!pauseOn(pauses, h.id, d)).map(
						(m) => m.date
					)
				)
			: undefined;
	return {
		id: h.id,
		name: h.name,
		direction: h.direction,
		/** A group: its days come from the habits inside it, logged on the day page. */
		group: isGroup(schedule),
		weeks,
		today,
		days: [],
		cells: chainCells(marks, rule, from, to, today, { start: h.startDate, unlogged }),
		summary: describeStreak(streak(marks, rule, { minimumCounts: h.minimumCounts, today }), rule),
		limit: false,
		startDate: h.startDate,
		canBackfill
	};
};
