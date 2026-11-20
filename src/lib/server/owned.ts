import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { habit, occurrence } from './db/schema';

/** An Occurrence with its Habit, only if it belongs to this account. */
export function ownedOccurrence(accountId: string, occurrenceId: string) {
	return (
		db
			.select({ occ: occurrence, habit })
			.from(occurrence)
			.innerJoin(habit, eq(occurrence.habitId, habit.id))
			.where(and(eq(occurrence.id, occurrenceId), eq(habit.accountId, accountId)))
			.get() ?? null
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
