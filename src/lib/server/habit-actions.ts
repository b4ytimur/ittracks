// Small changes to a habit that the Habits list makes in place and the habit editor makes too:
// archive, unarchive, rename, and moving it into or out of a group. One place, so both doors behave the same.
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { habit } from './db/schema';
import { ownedHabit } from './owned';
import { checkLinks, getHabitForm, parentsAfter, reachBack, setHabitArchived, type ScheduleApplies } from './repo/habits';
import { settle, syncTree, unarchived, userToday } from './today';
import { withSnapshot } from './snapshot';
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
 * For past days too (`applies` 'past', also on a habit already moved there today) it sits there on
 * every day, a group reaches back to its start, and the result carries an Undo (a snapshot).
 */
export function moveHabit(
	accountId: string,
	id: string,
	parentId: string | null,
	today: string = userToday(accountId),
	applies: ScheduleApplies = 'today'
): { error: string } | { parentId: string | null; undo?: string; groupStart?: string | null } {
	const f = getHabitForm(accountId, id);
	if (!f) return { error: 'No such habit' };
	if (f.parentId === parentId && applies === 'today') return { parentId };
	if (parentId && f.direction === 'break') return { error: 'A habit to break can’t sit inside another habit yet' };
	const refused = checkLinks(accountId, id, { ...f, parentId });
	if (refused) return { error: refused };
	const before = db.select({ parentId: habit.parentId, startDate: habit.startDate, earlierParents: habit.earlierParents }).from(habit).where(eq(habit.id, id)).get()!;
	const move = () => {
		db.update(habit)
			// Past days too: it sits there on every day, also when it was moved there earlier today.
			.set({ parentId, earlierParents: applies === 'past' ? null : parentsAfter(before, { parentId, schedule: f.schedule }, applies, today) })
			.where(and(eq(habit.id, id), eq(habit.accountId, accountId)))
			.run();
		return applies === 'past' && parentId ? reachBack(accountId, parentId, before.startDate) : null;
	};
	if (applies === 'today') return move(), { parentId };
	// The days it now counts on are written at once, so the Undo puts back exactly those.
	const { result: groupStart, undo } = withSnapshot(
		accountId,
		id,
		() => {
			const r = move();
			syncTree(accountId, today);
			return r;
		},
		Date.now(),
		parentId ? [parentId] : []
	);
	return { parentId, undo, groupStart };
}
