// Habits point to a part of the day by its name ("Morning"), so Settings needs to know
// which names are in use, and renaming a part moves its habits along with it.
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { habit } from '../db/schema';
import type { DayRange } from '$lib/engine/day';

/** Each part of the day a habit is set for, once per habit. */
export function usedRanges(accountId: string): string[] {
	return db
		.select({ cue: habit.cue })
		.from(habit)
		.where(eq(habit.accountId, accountId))
		.all()
		.flatMap((h) => (h.cue?.range ? [h.cue.range] : []));
}

/** Point habits set for an old part name at its new name. */
export function renameRanges(accountId: string, renames: Map<string, string>) {
	if (!renames.size) return;
	db.transaction((tx) => {
		for (const h of tx.select({ id: habit.id, cue: habit.cue }).from(habit).where(eq(habit.accountId, accountId)).all()) {
			const to = h.cue?.range ? renames.get(h.cue.range) : undefined;
			if (to && h.cue) tx.update(habit).set({ cue: { ...h.cue, range: to } }).where(eq(habit.id, h.id)).run();
		}
	});
}

/**
 * Parts the user renamed: each row sends the name it had when the page opened (`rangeWas`).
 * A rename only counts when the old name is gone and the new one was saved.
 */
export function readRenames(f: FormData, saved: DayRange[]): Map<string, string> {
	const names = f.getAll('rangeName').map((v) => String(v).trim());
	const was = f.getAll('rangeWas').map((v) => String(v).trim());
	const has = (n: string) => saved.some((r) => r.name === n);
	const out = new Map<string, string>();
	was.forEach((old, i) => {
		const to = names[i];
		if (old && to && old !== to && has(to) && !has(old)) out.set(old, to);
	});
	return out;
}
