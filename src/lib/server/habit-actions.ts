// Small changes to a habit that the Habits list makes in place and the habit editor makes too:
// archive, unarchive, rename. One place, so both doors behave the same.
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './db';
import { habit } from './db/schema';
import { ownedHabit } from './owned';
import { setHabitArchived } from './repo/habits';
import { settle, unarchived } from './today';
import type { ScheduleForm } from '$lib/forms';

/** The same rule as the habit form's name. */
export const habitName = z.string().trim().min(1, 'A name is required').max(120, 'Keep names to 120 characters or fewer');

/** Archive a habit. Its misses up to today are counted first: days in the archive are not. */
export function archiveHabit(accountId: string, id: string, today: string): boolean {
	const h = ownedHabit(accountId, id);
	if (!h) return false;
	if (h.direction === 'build' && h.schedule) settle(accountId, h.id, h.schedule as ScheduleForm, today);
	setHabitArchived(accountId, id, true);
	return true;
}

/** Bring a habit back from the archive. Days it spent archived are not counted as missed. */
export function unarchiveHabit(accountId: string, id: string, today: string): boolean {
	if (!ownedHabit(accountId, id)) return false;
	setHabitArchived(accountId, id, false);
	unarchived(id, today);
	return true;
}

/** Rename a habit. A name is display only: past logs keep pointing at the habit, not its name. */
export function renameHabit(accountId: string, id: string, name: string): { error: string } | { name: string } {
	const parsed = habitName.safeParse(name);
	if (!parsed.success) return { error: parsed.error.issues[0].message };
	if (!ownedHabit(accountId, id)) return { error: 'No such habit' };
	db.update(habit)
		.set({ name: parsed.data })
		.where(and(eq(habit.id, id), eq(habit.accountId, accountId)))
		.run();
	return { name: parsed.data };
}
