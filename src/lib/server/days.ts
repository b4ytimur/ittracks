// The days block and History's year strip: done and due on each day of a span, for every habit or one.
import { and, eq, gte, isNull, lte, min } from 'drizzle-orm';
import { db } from './db';
import { habit, occurrence } from './db/schema';
import { addDays, weekStart } from '$lib/engine/dates';
import { isGroup } from '$lib/engine/schedule';
import { spanOf, YEAR_WEEKS, type Count, type Show } from '$lib/days/days';

const counted = (accountId: string) =>
	// A group's day is already counted in the habits inside it, and a tracker's never counts.
	and(eq(habit.accountId, accountId), eq(habit.scoring, 'habit'), isNull(occurrence.rollup));

/** Every day from `from` to `to`, each [done, due]; skipped days count for neither. */
export function dayCounts(accountId: string, from: string, to: string, habitId: string | null = null): Record<string, Count> {
	const rows = db
		.select({ date: occurrence.date, status: occurrence.status })
		.from(occurrence)
		.innerJoin(habit, eq(occurrence.habitId, habit.id))
		.where(and(counted(accountId), gte(occurrence.date, from), lte(occurrence.date, to), habitId ? eq(habit.id, habitId) : undefined))
		.all();
	const out: Record<string, Count> = {};
	for (let d = from; d <= to; d = addDays(d, 1)) out[d] = [0, 0];
	for (const r of rows) {
		if (r.status === 'skipped' || !out[r.date]) continue;
		out[r.date][1]++;
		if (r.status === 'done') out[r.date][0]++;
	}
	return out;
}

/** The first day anything counted was due: the block goes no further back. */
export function firstDay(accountId: string): string | null {
	const [r] = db.select({ d: min(occurrence.date) }).from(occurrence).innerJoin(habit, eq(occurrence.habitId, habit.id)).where(counted(accountId)).all();
	return r?.d ?? null;
}

/** The habits the block can count one at a time: build habits that count, not groups, not archived. */
export function dayHabits(accountId: string): { id: string; name: string }[] {
	return db
		.select({ id: habit.id, name: habit.name, schedule: habit.schedule })
		.from(habit)
		.where(and(eq(habit.accountId, accountId), eq(habit.scoring, 'habit'), eq(habit.direction, 'build'), eq(habit.archived, false)))
		.all()
		.filter((h) => !isGroup(h.schedule as { kind: string } | null))
		.map(({ id, name }) => ({ id, name }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What a page hands the days block: the last 12 months (and the span around `at`, when that is older) counted,
 * the first day, the habits, and the saved choice with a habit that is gone put back to all.
 */
export function daysData(accountId: string, today: string, saved: { show: Show; habit: string | null }, at: string = today) {
	const habits = dayHabits(accountId);
	const habitId = habits.some((h) => h.id === saved.habit) ? saved.habit : null;
	const from = [addDays(weekStart(today), -7 * (YEAR_WEEKS - 1)), spanOf(saved.show, at, today)[0], weekStart(at)].sort()[0];
	return { today, first: firstDay(accountId), habits, show: saved.show, habit: habitId, counts: dayCounts(accountId, from, today, habitId) };
}
