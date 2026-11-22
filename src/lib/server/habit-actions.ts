// Small changes to a habit that the Habits list makes in place and the habit editor makes too:
// archive, unarchive, rename, and moving it into or out of a group. One place, so both doors behave the same.
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { habit } from './db/schema';
import { ownedHabit } from './owned';
import { checkLinks, getHabitForm, setHabitArchived } from './repo/habits';
import { settle, unarchived, userToday } from './today';
import { keepParent } from '$lib/engine/tree';
import { name as habitName, type ScheduleForm } from '$lib/forms';

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

/**
 * Put a habit inside a group or a routine, or with `parentId` null back at the top. The editor's
 * checks decide what may hold what. The move applies from today on: the days before keep the
 * group or routine it sat in (habit.earlierParents), so their days and streaks stay as they were.
 */
export function moveHabit(
	accountId: string,
	id: string,
	parentId: string | null,
	today: string = userToday(accountId)
): { error: string } | { parentId: string | null } {
	const f = getHabitForm(accountId, id);
	if (!f) return { error: 'No such habit' };
	if (f.parentId === parentId) return { parentId };
	if (parentId && f.direction === 'break') return { error: 'A habit to break can’t sit inside another habit yet' };
	const refused = checkLinks(accountId, id, { ...f, parentId });
	if (refused) return { error: refused };
	const before = db.select({ startDate: habit.startDate, earlierParents: habit.earlierParents }).from(habit).where(eq(habit.id, id)).get()!;
	db.update(habit)
		.set({ parentId, earlierParents: keepParent(before.earlierParents, f.parentId, parentId, before.startDate, today) })
		.where(and(eq(habit.id, id), eq(habit.accountId, accountId)))
		.run();
	return { parentId };
}
