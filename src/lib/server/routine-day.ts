// A routine's day: the habits inside it that are due, in order, each logged on its own (its values
// land in its own log) and the routine judged from them. Done, Skip and Undo work per habit or for
// the whole routine at once.
import { eq } from 'drizzle-orm';
import { progressText } from '$lib/engine/progress';
import { rollupText } from '$lib/engine/rollup';
import { db } from './db';
import { slot } from './db/schema';
import { ownedOccurrence } from './owned';
import { progressForIds } from './progress';
import { isRoutine, kidsOn, markedBy } from './rollup';
import { restoreUnchanged, snapshot } from './backfill';
import type { Actor } from './core/actor';
import { emit } from './core/events';
import { syncTree, userToday } from './today';

/** The routine's day and the habits inside it due that day, or null when it isn't one. */
export function routineDay(accountId: string, occurrenceId: string) {
	const o = ownedOccurrence(accountId, occurrenceId);
	if (!o || !isRoutine(o.habit.id, o.occ.date)) return null;
	const kids = kidsOn(o.habit.id, o.occ.date).filter((k) => !k.occ.extra);
	return kids.length ? { o, kids } : null;
}

export type RoutineDay = NonNullable<ReturnType<typeof routineSteps>>;
/** That day as its log shows it. */
export function routineSteps(accountId: string, occurrenceId: string) {
	const day = routineDay(accountId, occurrenceId);
	if (!day) return null;
	const { o, kids } = day;
	const progress = progressForIds(kids.map((k) => k.occ.id));
	return {
		occurrenceId: o.occ.id,
		name: o.habit.name,
		date: o.occ.date,
		status: o.occ.status,
		level: o.occ.level,
		count: o.occ.rollup && o.occ.status !== 'skipped' ? rollupText(o.occ.rollup) : null,
		/** Its own Done or Skip marked habits inside it, so opening it again has something to take back. */
		undoable: markedBy(accountId, o.occ).length > 0,
		steps: kids.map((k) => {
			const p = progress.get(k.occ.id);
			return {
				occurrenceId: k.occ.id,
				name: k.habit.name,
				status: k.occ.status,
				level: k.occ.level,
				progress: p ? progressText(p) : null,
				/** A habit with Tasks is a whole log of its own; one without is done here. */
				hasTasks: !!(k.occ.variantId && db.select({ id: slot.id }).from(slot).where(eq(slot.variantId, k.occ.variantId)).get()),
				log: `/log/${k.occ.id}?back=${encodeURIComponent(`/log/${o.occ.id}`)}`
			};
		})
	};
}

/** Mark or skip a routine, with what it takes to put back exactly the habits it marked. Nothing to add for any other habit. */
export function withRoutineUndo<T>(occ: { habitId: string; date: string }, run: () => T): { result: T; undo?: string } {
	if (!isRoutine(occ.habitId, occ.date)) return { result: run() };
	const before = snapshot(occ.habitId, occ.date);
	const result = run();
	return { result, undo: JSON.stringify({ before, after: snapshot(occ.habitId, occ.date) }) };
}

export function undoRoutine(actor: Actor, occ: { habitId: string; date: string }, raw: string): boolean {
	let u: { before?: { habitId?: string; date?: string }; after?: unknown };
	try {
		u = JSON.parse(raw);
	} catch {
		return false;
	}
	if (u?.before?.habitId !== occ.habitId || u.before.date !== occ.date || !restoreUnchanged(actor.accountId, u.before, u.after)) return false;
	syncTree(actor.accountId, userToday(actor.accountId, actor.tz));
	emit(actor, 'occurrence.restored', { habitId: occ.habitId, date: occ.date });
	return true;
}
