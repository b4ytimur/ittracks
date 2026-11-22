import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from './db';
import { habit, occurrence } from './db/schema';

/**
 * An Occurrence with its Habit, only if it belongs to this account. A group's day is worked out
 * from the habits inside it, so it can't be logged: it counts as not found here.
 */
export function ownedOccurrence(accountId: string, occurrenceId: string) {
	return (
		db
			.select({ occ: occurrence, habit })
			.from(occurrence)
			.innerJoin(habit, eq(occurrence.habitId, habit.id))
			.where(and(eq(occurrence.id, occurrenceId), eq(habit.accountId, accountId), isNull(occurrence.rollup)))
			.get() ?? null
	);
}

/** The group a stored group day belongs to, for links that land on one. */
export function groupOfOccurrence(accountId: string, occurrenceId: string): string | null {
	return (
		db
			.select({ id: habit.id })
			.from(occurrence)
			.innerJoin(habit, eq(occurrence.habitId, habit.id))
			.where(and(eq(occurrence.id, occurrenceId), eq(habit.accountId, accountId), isNotNull(occurrence.rollup)))
			.get()?.id ?? null
	);
}

export function ownedHabit(accountId: string, habitId: string) {
	return (
		db
			.select()
			.from(habit)
			.where(and(eq(habit.id, habitId), eq(habit.accountId, accountId)))
			.get() ?? null
	);
}
