// A deleted habit or Task is archived and goes for good after a while, so Delete needs no question:
// it can be put back until then.
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { db } from './db';
import { habit, task } from './db/schema';
import { archiveHabit, unarchiveHabit } from './habit-actions';
import { deleteHabit } from './repo/habits';
import { deleteTask, setTaskArchived } from './repo/tasks';
import { getSettings, saveSettings } from './settings';

export const KEEP_MS = 10 * 60_000;
const tables = { habit, task };
export type Kind = keyof typeof tables;

/** Returns whether it was archived before, for putting it back as it was; null when there is no such thing. */
export function trash(accountId: string, kind: Kind, id: string, today: string, now = Date.now()): { archived: boolean } | null {
	const t = tables[kind];
	const row = db.select({ archived: t.archived, gone: t.deleteAfter }).from(t).where(and(eq(t.id, id), eq(t.accountId, accountId))).get();
	if (!row || row.gone) return null;
	if (!row.archived) kind === 'habit' ? archiveHabit(accountId, id, today) : setTaskArchived(accountId, id, true);
	db.update(t).set({ deleteAfter: new Date(now + KEEP_MS) }).where(eq(t.id, id)).run();
	return { archived: row.archived };
}

/** Put it back, archived or not as it was. False when it is too late. */
export function untrash(accountId: string, kind: Kind, id: string, archived: boolean, today: string): boolean {
	const t = tables[kind];
	const r = db.update(t).set({ deleteAfter: null }).where(and(eq(t.id, id), eq(t.accountId, accountId), isNotNull(t.deleteAfter))).run();
	if (!r.changes) return false;
	if (!archived) kind === 'habit' ? unarchiveHabit(accountId, id, today) : setTaskArchived(accountId, id, false);
	return true;
}

/** Delete for good what is past its time. */
export function sweep(now = Date.now()): number {
	const due = new Date(now);
	let n = 0;
	for (const h of db.select({ id: habit.id, accountId: habit.accountId }).from(habit).where(and(lt(habit.deleteAfter, due), eq(habit.archived, true))).all()) {
		deleteHabit(h.accountId, h.id);
		const s = getSettings(h.accountId);
		if (s.pinned.includes(h.id)) saveSettings(h.accountId, { pinned: s.pinned.filter((x) => x !== h.id) });
		n++;
	}
	for (const t of db.select({ id: task.id, accountId: task.accountId }).from(task).where(and(lt(task.deleteAfter, due), eq(task.archived, true))).all()) {
		deleteTask(t.accountId, t.id);
		n++;
	}
	return n;
}
