// What is logged against a Task or a habit, for the history policies (src/lib/rules/history.ts),
// and the one migration they can ask for: converting a field's past values to a new unit.
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from './db';
import { craving, entry, habit, metric, occurrence, slip, slot, task, taskPart, variant } from './db/schema';
import type { TaskLogged } from '$lib/rules/task';
import { roundConverted } from '$lib/units';
import { keepGoals } from './progress';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = typeof db | Tx;

/** An edit refused by the history policies (src/lib/rules/history.ts), in the user's words. */
export class PastEditError extends Error {}

const filled = (v: unknown) => v !== undefined && v !== null && v !== '';

/**
 * The Task's Metrics that have a value in any log, the Choice options picked, and its parts
 * with anything logged under them: a step ticked (its own Entries, from before paths too), or
 * a value at a path through the part.
 */
export function taskLogged(taskId: string, q: Db = db): { metrics: Set<string>; parts: Set<string>; options: Set<string> } {
	const types = new Map(q.select({ id: metric.id, type: metric.type }).from(metric).where(eq(metric.taskId, taskId)).all().map((m) => [m.id, m.type]));
	const metrics = new Set<string>();
	const options = new Set<string>();
	for (const e of q.select({ values: entry.values }).from(entry).where(eq(entry.taskId, taskId)).all())
		for (const [k, v] of Object.entries(e.values ?? {})) {
			if (!types.has(k) || !filled(v)) continue;
			metrics.add(k);
			if (types.get(k) === 'choice' && typeof v === 'string') options.add(v);
		}
	const parts = new Set<string>();
	for (const p of q.select({ id: taskPart.id, childTaskId: taskPart.childTaskId }).from(taskPart).where(eq(taskPart.taskId, taskId)).all()) {
		const step = p.id === p.childTaskId && q.select({ id: entry.id }).from(entry).where(eq(entry.taskId, p.childTaskId)).get();
		const under = q
			.select({ id: entry.id })
			.from(entry)
			.where(sql`instr(${entry.path}, ${'/' + p.id}) > 0`)
			.get();
		if (step || under) parts.add(p.id);
	}
	return { metrics, parts, options };
}

/** For the editor: the same, as lists. */
export const taskLoggedLists = (taskId: string): TaskLogged & { metrics: string[]; parts: string[]; options: string[] } => {
	const l = taskLogged(taskId);
	return { metrics: [...l.metrics], parts: [...l.parts], options: [...l.options] };
};

/** The feelings (ids) the habit's slips were logged with. */
export function feelingsUsed(habitId: string, q: Db = db): Set<string> {
	return new Set(
		q
			.selectDistinct({ f: slip.feeling })
			.from(slip)
			.where(and(eq(slip.habitId, habitId), isNotNull(slip.feeling)))
			.all()
			.map((r) => r.f!)
	);
}

/**
 * Has anything been logged for this habit: a day done or skipped, a value, a note, a slip or a
 * resisted craving? Misses the app wrote for days nobody logged don't count, nor do a group's
 * days, which are worked out from the habits inside it.
 */
export function habitLogged(habitId: string, q: Db = db): boolean {
	const touched = q
		.select({ id: occurrence.id })
		.from(occurrence)
		.where(and(eq(occurrence.habitId, habitId), inArray(occurrence.status, ['done', 'skipped']), isNull(occurrence.rollup)))
		.get();
	if (touched) return true;
	if (q.select({ id: occurrence.id }).from(occurrence).where(and(eq(occurrence.habitId, habitId), isNotNull(occurrence.notes))).get()) return true;
	if (q.select({ id: entry.id }).from(entry).innerJoin(occurrence, eq(entry.occurrenceId, occurrence.id)).where(eq(occurrence.habitId, habitId)).get())
		return true;
	return !!(
		q.select({ id: slip.id }).from(slip).where(eq(slip.habitId, habitId)).get() ??
		q.select({ id: craving.id }).from(craving).where(eq(craving.habitId, habitId)).get()
	);
}

/** Told about every row a change writes, with the columns before and after: how bulk Undo puts them back. */
export type OnWrite = (table: 'entry' | 'slot' | 'taskPart' | 'occurrence', id: string, before: Record<string, unknown>, after: Record<string, unknown>) => void;

const scale = (r: Record<string, number> | null | undefined, metricId: string, f: number) =>
	r && typeof r[metricId] === 'number' ? { ...r, [metricId]: roundConverted(r[metricId] * f) } : r;

/**
 * Convert one Metric's past values by `factor` (kg to lb: 2.2046): every logged value, the
 * targets of every Slot, and the targets kept with past logs. Runs inside the Task's save (or a
 * bulk change), so the new unit and the converted numbers land together or not at all.
 */
export function convertMetricValues(tx: Db, accountId: string, taskId: string, metricId: string, factor: number, onWrite?: OnWrite) {
	for (const e of tx.select({ id: entry.id, values: entry.values }).from(entry).where(eq(entry.taskId, taskId)).all()) {
		const v = e.values?.[metricId];
		if (typeof v !== 'number') continue;
		const values = { ...e.values, [metricId]: roundConverted(v * factor) };
		onWrite?.('entry', e.id, { values: e.values }, { values });
		tx.update(entry).set({ values }).where(eq(entry.id, e.id)).run();
	}
	// Slots of this account that have a target for the field: fixed to the Task, or open.
	const slots = tx
		.select({ s: slot })
		.from(slot)
		.innerJoin(variant, eq(slot.variantId, variant.id))
		.innerJoin(habit, eq(variant.habitId, habit.id))
		.where(eq(habit.accountId, accountId))
		.all()
		.map((r) => r.s);
	for (const s of slots) {
		if (![s.targets, s.minTargets, s.stretchTargets].some((r) => r && metricId in r)) continue;
		const set = { targets: scale(s.targets, metricId, factor), minTargets: scale(s.minTargets, metricId, factor), stretchTargets: scale(s.stretchTargets, metricId, factor) };
		onWrite?.('slot', s.id, { targets: s.targets, minTargets: s.minTargets, stretchTargets: s.stretchTargets }, set);
		tx.update(slot).set(set).where(eq(slot.id, s.id)).run();
	}
	// Parts that aim for the field inside another Task.
	for (const p of partsAiming(tx, accountId, [metricId])) {
		const set = { targets: scale(p.targets, metricId, factor), minTargets: scale(p.minTargets, metricId, factor), stretchTargets: scale(p.stretchTargets, metricId, factor) };
		onWrite?.('taskPart', p.id, { targets: p.targets, minTargets: p.minTargets, stretchTargets: p.stretchTargets }, set);
		tx.update(taskPart).set(set).where(eq(taskPart.id, p.id)).run();
	}
	const kept = tx
		.select({ id: occurrence.id, goals: occurrence.goals })
		.from(occurrence)
		.innerJoin(habit, eq(occurrence.habitId, habit.id))
		.where(and(eq(habit.accountId, accountId), isNotNull(occurrence.goals)))
		.all();
	for (const o of kept) {
		let changed = false;
		const goals = Object.fromEntries(
			Object.entries(o.goals ?? {}).map(([slotId, g]) => {
				if (![g.targets, g.minTargets, g.stretchTargets].some((r) => r && metricId in r)) return [slotId, g];
				changed = true;
				return [slotId, { ...g, targets: scale(g.targets, metricId, factor) ?? null, minTargets: scale(g.minTargets, metricId, factor) ?? null, stretchTargets: scale(g.stretchTargets, metricId, factor) ?? null }];
			})
		);
		if (!changed) continue;
		onWrite?.('occurrence', o.id, { goals: o.goals }, { goals });
		tx.update(occurrence).set({ goals }).where(eq(occurrence.id, o.id)).run();
	}
}

/**
 * Archived Metrics leave the Slots' targets, so a new log isn't asked to reach a field it no
 * longer shows. Logs made before keep the targets they aimed for (keepGoals).
 */
export function dropTargets(tx: Tx, accountId: string, metricIds: string[]) {
	if (!metricIds.length) return;
	const gone = new Set(metricIds);
	const slots = tx
		.select({ s: slot })
		.from(slot)
		.innerJoin(variant, eq(slot.variantId, variant.id))
		.innerJoin(habit, eq(variant.habitId, habit.id))
		.where(eq(habit.accountId, accountId))
		.all()
		.map((r) => r.s)
		.filter((s) => [s.targets, s.minTargets, s.stretchTargets].some((r) => r && Object.keys(r).some((k) => gone.has(k))));
	keepGoals(tx, [...new Set(slots.map((s) => s.variantId))]);
	const without = (r: Record<string, number> | null) => (r ? Object.fromEntries(Object.entries(r).filter(([k]) => !gone.has(k))) : r);
	for (const s of slots)
		tx.update(slot)
			.set({ targets: without(s.targets), minTargets: without(s.minTargets), stretchTargets: without(s.stretchTargets) })
			.where(eq(slot.id, s.id))
			.run();
	for (const p of partsAiming(tx, accountId, metricIds))
		tx.update(taskPart)
			.set({ targets: without(p.targets), minTargets: without(p.minTargets), stretchTargets: without(p.stretchTargets) })
			.where(eq(taskPart.id, p.id))
			.run();
}

/** Parts of this account's Tasks with a target for any of these fields. */
function partsAiming(tx: Db, accountId: string, metricIds: string[]) {
	const ids = new Set(metricIds);
	return tx
		.select({ p: taskPart })
		.from(taskPart)
		.innerJoin(task, eq(taskPart.taskId, task.id))
		.where(eq(task.accountId, accountId))
		.all()
		.map((r) => r.p)
		.filter((p) => [p.targets, p.minTargets, p.stretchTargets].some((r) => r && Object.keys(r).some((k) => ids.has(k))));
}
