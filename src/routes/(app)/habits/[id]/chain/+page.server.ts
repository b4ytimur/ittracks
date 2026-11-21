import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { occurrence, slip } from '$lib/server/db/schema';
import { ownedHabit } from '$lib/server/owned';
import { userToday } from '$lib/server/today';
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
		return { id: h.id, name: h.name, direction: h.direction, weeks, today, days, cells: [], summary: '', limit: !!h.limit };
	}

	const marks = db
		.select({ date: occurrence.date, status: occurrence.status, level: occurrence.level })
		.from(occurrence)
		.where(eq(occurrence.habitId, h.id))
		.orderBy(asc(occurrence.date))
		.all();
	const rule = h.streakRule as StreakRule;
	return {
		id: h.id,
		name: h.name,
		direction: h.direction,
		weeks,
		today,
		days: [],
		cells: chainCells(marks, rule, from, to, today),
		summary: describeStreak(streak(marks, rule, { minimumCounts: h.minimumCounts, today }), rule),
		limit: false
	};
};
