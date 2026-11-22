// Progress of logs ("3 of 6 glasses", "2 of 4 steps") for many Occurrences at once,
// and the +1 button on Today that counts toward a habit's one target.
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { db } from './db';
import { entry, habit, metric, occurrence, slot, task, type SlotGoals } from './db/schema';
import { amountTarget, loggedValue, progressOf, verdict, type Progress, type ProgressMetric, type ProgressSlot, type Verdict } from '$lib/engine/progress';
import { defaultStep } from '$lib/task-types';
import type { Level } from '$lib/engine/streak';

interface OccRow {
	id: string;
	variantId: string | null;
	picks: Record<string, string> | null;
	level: Level | null;
	status: string;
	/** The targets the Slots had when they changed later; null when today's still apply. */
	goals?: Record<string, SlotGoals> | null;
}

type Goals = Pick<SlotGoals, 'targets' | 'minTargets' | 'stretchTargets'>;

/** Targets at a level, falling back to Target for Metrics the level doesn't set. */
export function targetsAt(s: Goals, level: Level | null): Record<string, number> {
	return {
		...(s.targets ?? {}),
		...((level === 'minimum' ? s.minTargets : level === 'stretch' ? s.stretchTargets : null) ?? {})
	};
}

/** What a Slot aimed for in one log: the targets kept with the log, else the Slot's own. */
export const goalsOf = (s: typeof slot.$inferSelect, o: { goals?: Record<string, SlotGoals> | null }): Goals => o.goals?.[s.id] ?? s;

/**
 * The Slots of each Occurrence, with the Task each one uses that day and what it has.
 * `level` measures against another level than the one logged (null is Target).
 */
function slotsFor(occs: OccRow[], level?: (o: OccRow) => Level | null): Map<string, ProgressSlot[]> {
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
				// A log is measured by the fields it asks for: archived ones are kept for History only.
				.where(and(inArray(metric.taskId, taskIds), eq(metric.archived, false)))
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
						targets: targetsAt(goalsOf(s, o), level ? level(o) : o.level)
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

const occCols = {
	id: occurrence.id,
	habitId: occurrence.habitId,
	date: occurrence.date,
	variantId: occurrence.variantId,
	picks: occurrence.picks,
	level: occurrence.level,
	status: occurrence.status,
	goals: occurrence.goals
};

/** Progress by Occurrence id, looking the Occurrences up first. */
export function progressForIds(ids: string[]): Map<string, Progress> {
	if (!ids.length) return new Map();
	const occs = [];
	for (let i = 0; i < ids.length; i += 900) occs.push(...db.select(occCols).from(occurrence).where(inArray(occurrence.id, ids.slice(i, i + 900))).all());
	return progressFor(occs);
}

/**
 * How each log with something in it counts under its habit's rule (see engine/progress.ts
 * `verdict`). Logs with nothing in them are left out: a plain Done counts, and an untouched
 * day is a miss (or ignored) as settling decides.
 */
export function verdictsFor(ids: string[]): Map<string, Verdict> {
	const out = new Map<string, Verdict>();
	if (!ids.length) return out;
	const occs: (OccRow & { habitId: string })[] = [];
	for (let i = 0; i < ids.length; i += 900) occs.push(...db.select(occCols).from(occurrence).where(inArray(occurrence.id, ids.slice(i, i + 900))).all());
	const withEntries = new Set<string>();
	for (let i = 0; i < occs.length; i += 900)
		for (const e of db
			.selectDistinct({ id: entry.occurrenceId })
			.from(entry)
			.where(inArray(entry.occurrenceId, occs.slice(i, i + 900).map((o) => o.id)))
			.all())
			withEntries.add(e.id);
	const logged = occs.filter((o) => withEntries.has(o.id));
	if (!logged.length) return out;
	const habits = new Map(
		db
			.select({ id: habit.id, minimumCounts: habit.minimumCounts, levels: habit.levels })
			.from(habit)
			.where(inArray(habit.id, [...new Set(logged.map((o) => o.habitId))]))
			.all()
			.map((h) => [h.id, h])
	);
	// Measured against the Target whatever level was logged, and against the Minimum.
	const atTarget = slotsFor(logged, () => null);
	const atMinimum = slotsFor(logged, () => 'minimum');
	const entriesOf = new Map<string, { taskId: string; values: Record<string, unknown> }[]>();
	for (let i = 0; i < logged.length; i += 900)
		for (const e of db
			.select({ occurrenceId: entry.occurrenceId, taskId: entry.taskId, values: entry.values })
			.from(entry)
			.where(inArray(entry.occurrenceId, logged.slice(i, i + 900).map((o) => o.id)))
			.orderBy(asc(entry.sortOrder))
			.all()) {
			const list = entriesOf.get(e.occurrenceId) ?? [];
			list.push(e);
			entriesOf.set(e.occurrenceId, list);
		}
	for (const o of logged) {
		const h = habits.get(o.habitId);
		const mine = entriesOf.get(o.id) ?? [];
		const t = progressOf(atTarget.get(o.id) ?? [], mine, 'due');
		// The habit has a Minimum when Levels are on and it sets a lower number to reach.
		const m = h?.levels?.enabled ? progressOf(atMinimum.get(o.id) ?? [], mine, 'due') : null;
		const hasMinimum = !!m && !!t && m.kind === 'amount' && t.kind === 'amount' && m.target < t.target;
		out.set(o.id, verdict(t, hasMinimum ? m : undefined, h?.minimumCounts ?? true));
	}
	return out;
}

/**
 * A log was finished (Finish, Done, Same as last): it is done when it counts under its
 * habit's rule. One that falls short stays open today, and is missed on a day that is over.
 * Its values stay either way. Returns the status it ends with.
 */
export function finishAs(occurrenceId: string, today: string): 'done' | 'due' | 'missed' | 'skipped' {
	const o = db.select({ status: occurrence.status, date: occurrence.date }).from(occurrence).where(eq(occurrence.id, occurrenceId)).get();
	if (!o) return 'due';
	if (o.status !== 'done' || verdictsFor([occurrenceId]).get(occurrenceId) !== 'short') return o.status;
	const status = o.date < today ? ('missed' as const) : ('due' as const);
	db.update(occurrence).set({ status, finishedAt: null }).where(eq(occurrence.id, occurrenceId)).run();
	return status;
}

/**
 * Judge logs again by their habit's rule, after the rule changed: a past log with something
 * in it is done when it counts and missed when it falls short. `before` limits it to days
 * that are over.
 */
export function rejudge(habitId: string, before: string) {
	const rows = db
		.select({ id: occurrence.id, status: occurrence.status })
		.from(occurrence)
		.where(and(eq(occurrence.habitId, habitId), lt(occurrence.date, before), inArray(occurrence.status, ['done', 'missed'])))
		.all();
	const v = verdictsFor(rows.map((r) => r.id));
	const toDone = rows.filter((r) => r.status === 'missed' && v.has(r.id) && v.get(r.id) !== 'short').map((r) => r.id);
	const toMissed = rows.filter((r) => r.status === 'done' && v.get(r.id) === 'short').map((r) => r.id);
	if (toDone.length) db.update(occurrence).set({ status: 'done' }).where(inArray(occurrence.id, toDone)).run();
	if (toMissed.length) db.update(occurrence).set({ status: 'missed', finishedAt: null }).where(inArray(occurrence.id, toMissed)).run();
}

/** How much one tap of +1 adds: the Metric's own step, else a sensible one for its type. */
export const plusStep = (m: { type: string; unit: string | null; step: number | null }) =>
	m.step ?? defaultStep(m.type, m.unit);

/** Each Metric's step by id, for a raise by steps (engine/progression.ts). */
export function stepsOf(metricIds: string[], q: Pick<typeof db, 'select'> = db): Record<string, number> {
	if (!metricIds.length) return {};
	return Object.fromEntries(
		q
			.select({ id: metric.id, type: metric.type, unit: metric.unit, step: metric.step })
			.from(metric)
			.where(inArray(metric.id, [...new Set(metricIds)]))
			.all()
			.map((m) => [m.id, plusStep(m)])
	);
}

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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Before a Variant's targets change (Raise, an edit): logs made against the old ones keep
 * them, so Target met, "3 of 6 glasses" and the habit's rule judge each log by what it
 * aimed for. Logs that already keep theirs are left as they are.
 */
export function keepGoals(tx: Tx, variantIds: string[]) {
	for (const variantId of variantIds) {
		const slots = tx.select().from(slot).where(eq(slot.variantId, variantId)).all();
		if (!slots.length) continue;
		const goals: Record<string, SlotGoals> = Object.fromEntries(
			slots.map((s) => [s.id, { taskId: s.taskId, sets: s.sets, targets: s.targets, minTargets: s.minTargets, stretchTargets: s.stretchTargets }])
		);
		tx.update(occurrence)
			.set({ goals })
			.where(and(eq(occurrence.variantId, variantId), isNull(occurrence.goals), inArray(occurrence.status, ['done', 'missed'])))
			.run();
	}
}
