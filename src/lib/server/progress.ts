// Progress of logs ("3 of 6 glasses", "2 of 4 steps") for many Occurrences at once,
// and the +1 button on Today that counts toward a habit's one target.
import { randomUUID } from 'node:crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from './db';
import { entry, metric, occurrence, slot, task } from './db/schema';
import { amountTarget, loggedValue, progressOf, type Progress, type ProgressMetric, type ProgressSlot } from '$lib/engine/progress';
import { defaultStep } from '$lib/task-types';
import type { Level } from '$lib/engine/streak';

interface OccRow {
	id: string;
	variantId: string | null;
	picks: Record<string, string> | null;
	level: Level | null;
	status: string;
}

/** Targets at a level, falling back to Target for Metrics the level doesn't set. */
function targetsAt(s: typeof slot.$inferSelect, level: Level | null): Record<string, number> {
	return {
		...(s.targets ?? {}),
		...((level === 'minimum' ? s.minTargets : level === 'stretch' ? s.stretchTargets : null) ?? {})
	};
}

/** The Slots of each Occurrence, with the Task each one uses that day and what it has. */
function slotsFor(occs: OccRow[]): Map<string, ProgressSlot[]> {
	const variantIds = [...new Set(occs.map((o) => o.variantId).filter((v): v is string => !!v))];
	const slots = variantIds.length
		? db.select().from(slot).where(inArray(slot.variantId, variantIds)).orderBy(asc(slot.sortOrder)).all()
		: [];
	const taskIds = [
		...new Set([...slots.map((s) => s.taskId), ...occs.flatMap((o) => Object.values(o.picks ?? {}))].filter((t): t is string => !!t))
	];
	const metrics = taskIds.length
		? db
				.select({ id: metric.id, taskId: metric.taskId, name: metric.name, type: metric.type, unit: metric.unit, repeats: metric.repeats, step: metric.step })
				.from(metric)
				.where(inArray(metric.taskId, taskIds))
				.orderBy(asc(metric.sortOrder))
				.all()
		: [];
	const subs = taskIds.length
		? db
				.select({ id: task.id, parent: task.parentTaskId, archived: task.archived })
				.from(task)
				.where(inArray(task.parentTaskId, taskIds))
				.all()
				.filter((t) => !t.archived)
		: [];
	const metricsOf = new Map<string, ProgressMetric[]>();
	for (const m of metrics) metricsOf.set(m.taskId, [...(metricsOf.get(m.taskId) ?? []), m]);
	const subsOf = new Map<string, string[]>();
	for (const s of subs) subsOf.set(s.parent!, [...(subsOf.get(s.parent!) ?? []), s.id]);
	const out = new Map<string, ProgressSlot[]>();
	for (const o of occs) {
		out.set(
			o.id,
			slots
				.filter((s) => s.variantId === o.variantId)
				.map((s) => {
					const taskId = o.picks?.[s.id] ?? s.taskId;
					return {
						taskId,
						metrics: taskId ? (metricsOf.get(taskId) ?? []) : [],
						subtaskIds: taskId ? (subsOf.get(taskId) ?? []) : [],
						targets: targetsAt(s, o.level)
					};
				})
		);
	}
	return out;
}

/** Progress of each Occurrence by id; ones with nothing worth saying are left out. */
export function progressFor(occs: OccRow[]): Map<string, Progress> {
	const out = new Map<string, Progress>();
	if (!occs.length) return out;
	const slots = slotsFor(occs);
	const entries = db
		.select({ occurrenceId: entry.occurrenceId, taskId: entry.taskId, values: entry.values })
		.from(entry)
		.where(inArray(entry.occurrenceId, occs.map((o) => o.id)))
		.orderBy(asc(entry.sortOrder))
		.all();
	for (const o of occs) {
		const p = progressOf(slots.get(o.id) ?? [], entries.filter((e) => e.occurrenceId === o.id), o.status);
		if (p) out.set(o.id, p);
	}
	return out;
}

/** Progress by Occurrence id, looking the Occurrences up first. */
export function progressForIds(ids: string[]): Map<string, Progress> {
	if (!ids.length) return new Map();
	return progressFor(
		db
			.select({ id: occurrence.id, variantId: occurrence.variantId, picks: occurrence.picks, level: occurrence.level, status: occurrence.status })
			.from(occurrence)
			.where(inArray(occurrence.id, ids))
			.all()
	);
}

/** How much one tap of +1 adds: the Metric's own step, else a sensible one for its type. */
export const plusStep = (m: { type: string; unit: string | null; step: number | null }) =>
	m.step ?? defaultStep(m.type, m.unit);

/**
 * +1 from Today, for a habit with one number to reach: add one step to the value logged so
 * far (or take one away with `by: -1`). Reaching the target finishes the log; dropping
 * below it on a log that +1 finished puts it back to due. Other saved values are kept.
 */
export function plusOne(occurrenceId: string, by: 1 | -1 = 1): { value: number; target: number; unit: string; done: boolean } | null {
	const o = db.select().from(occurrence).where(eq(occurrence.id, occurrenceId)).get();
	if (!o) return null;
	const slots = slotsFor([o]).get(o.id) ?? [];
	const amount = amountTarget(slots);
	if (!amount) return null;
	const taskId = amount.slot.taskId!;
	const m = amount.metric;
	const mine = db
		.select()
		.from(entry)
		.where(eq(entry.occurrenceId, o.id))
		.orderBy(asc(entry.sortOrder))
		.all();
	const before = loggedValue(mine, taskId, m.id);
	const step = plusStep(m);
	const value = Math.max(0, Math.round((before + by * step) * 1000) / 1000);
	const done = value >= amount.target;
	db.transaction((tx) => {
		const summary = mine.find((e) => e.taskId === taskId && e.values._summary);
		if (summary) tx.update(entry).set({ values: { ...summary.values, [m.id]: value } }).where(eq(entry.id, summary.id)).run();
		else
			tx.insert(entry)
				.values({ id: randomUUID(), occurrenceId: o.id, taskId, values: { [m.id]: value, _summary: true }, sortOrder: mine.length })
				.run();
		if (done && o.status !== 'done') tx.update(occurrence).set({ status: 'done', finishedAt: new Date() }).where(eq(occurrence.id, o.id)).run();
		if (!done && o.status === 'done' && by < 0) tx.update(occurrence).set({ status: 'due', finishedAt: null }).where(eq(occurrence.id, o.id)).run();
	});
	const unit = m.unit || (m.type === 'duration' ? 'min' : m.name.toLowerCase());
	return { value, target: amount.target, unit, done };
}
