// Pauses: one habit resting for a date range, or a vacation (no habit: every habit rests). The habit
// page, the Vacation line in Settings and setup (core/setup.ts) all add and take them back here, so
// each one takes back or counts again the misses of the days it covers the same way.
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { pause } from './db/schema';
import { repaused } from './today';

export type PauseRow = typeof pause.$inferSelect;

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Add a pause (habitId null: a vacation). A pause over past days takes back the misses counted for them. */
export function addPause(accountId: string, habitId: string | null, start: string, end: string, note: string | null, today: string): { id: string } | { error: string } {
	if (!isDate(start) || !isDate(end) || end < start) return { error: 'Pick a start and an end date, the end not before the start.' };
	const id = randomUUID();
	db.insert(pause).values({ id, accountId, habitId, start, end, note: note?.slice(0, 120) || null }).run();
	repaused(accountId, habitId, start, end, today);
	return { id };
}

/** Take a pause away; its days count again. Returns what it was, so it can be put back. */
export function removePause(accountId: string, id: string, today: string): PauseRow | null {
	const where = and(eq(pause.id, id), eq(pause.accountId, accountId));
	const p = db.select().from(pause).where(where).get();
	if (!p) return null;
	db.delete(pause).where(where).run();
	repaused(accountId, p.habitId, p.start, p.end, today);
	return p;
}

/** Put a removed pause back as it was. */
export function restorePause(accountId: string, p: PauseRow, today: string) {
	db.insert(pause).values({ ...p, accountId, createdAt: new Date(p.createdAt) }).onConflictDoNothing().run();
	repaused(accountId, p.habitId, p.start, p.end, today);
}

/** The pauses of a habit (or the vacations, with null), oldest first. */
export const pausesOf = (accountId: string, habitId: string | null) =>
	db
		.select()
		.from(pause)
		.where(eq(pause.accountId, accountId))
		.all()
		.filter((p) => p.habitId === habitId)
		.sort((a, b) => (a.start < b.start ? -1 : 1));
