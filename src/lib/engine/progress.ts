// How far along a log is: "3 of 6 glasses" for a habit with one number to reach, or
// "2 of 4 steps" for one made of several Tasks, steps inside them and Yes or no ticks.
// Shown on Today, the past-day page and History, so a partial day doesn't read as plain "Done".
import { isStep, place } from './parts';

export interface ProgressMetric {
	id: string;
	name: string;
	type: string;
	unit: string | null;
	repeats: boolean;
	step: number | null;
	/** Less is better: its target is a most, not a least (a taper, cigarettes). */
	better?: 'more' | 'less' | null;
}

/** One place in a log (see engine/parts.ts): a Slot's Task, or a Task inside it. */
export interface ProgressSlot {
	path: string;
	taskId: string;
	metrics: ProgressMetric[];
	/** Parts inside it: a Task made of steps is not a step itself unless it has fields. */
	kids: number;
	/** Targets at the log's level (falling back to Target), by Metric id. */
	targets: Record<string, number>;
}

export interface ProgressEntry {
	taskId: string;
	path?: string | null;
	values: Record<string, unknown>;
}

export type Progress =
	/** One number to reach, such as glasses of water or minutes read. */
	| { kind: 'amount'; value: number; target: number; unit: string; name: string; taskId: string; metricId: string; type: string; step: number | null; less: boolean }
	/** Several things to do, each one a step: a Task logged, or a step or a Yes or no Task ticked. */
	| { kind: 'steps'; done: number; total: number };

const numeric = (t: string) => t === 'number' || t === 'count' || t === 'duration';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The single target a habit counts toward, when it has exactly one: one Task with one
 * once-per-log number that has a target, no sets and nothing inside it. Other fields (a note,
 * a choice) may sit next to it.
 */
export function amountTarget(slots: ProgressSlot[]): { slot: ProgressSlot; metric: ProgressMetric; target: number } | null {
	if (slots.length !== 1) return null;
	const s = slots[0];
	if (s.kids || s.metrics.some((m) => m.repeats)) return null;
	const withTarget = s.metrics.filter((m) => numeric(m.type) && isNum(s.targets[m.id]) && s.targets[m.id] > 0);
	if (withTarget.length !== 1) return null;
	return { slot: s, metric: withTarget[0], target: s.targets[withTarget[0].id] };
}

/** The value logged so far for one once-per-log Metric of a Task. */
export function loggedValue(entries: ProgressEntry[], taskId: string, metricId: string): number {
	let v = 0;
	for (const e of entries) if (e.taskId === taskId && isNum(e.values[metricId])) v = e.values[metricId] as number;
	return v;
}

/**
 * How far along a log is, or null when there is nothing worth saying (one step, nothing
 * logged yet on a habit of steps, or a finished log with no entries at all, such as a
 * one-tap Done from before steps were saved).
 */
export function progressOf(slots: ProgressSlot[], entries: ProgressEntry[], status: string): Progress | null {
	const amount = amountTarget(slots);
	if (amount) {
		const value = loggedValue(entries, amount.slot.taskId!, amount.metric.id);
		if (status === 'done' && !entries.length) return null;
		return {
			kind: 'amount',
			value,
			target: amount.target,
			unit: amount.metric.unit || (amount.metric.type === 'duration' ? 'min' : amount.metric.name.toLowerCase()),
			name: amount.metric.name,
			taskId: amount.slot.taskId!,
			metricId: amount.metric.id,
			type: amount.metric.type,
			step: amount.metric.step,
			less: amount.metric.better === 'less'
		};
	}
	const { at, orphans } = place(slots, entries);
	let total = 0;
	let done = 0;
	// Each place is a step when it has fields to fill in, or is a plain Yes or no; a Task
	// made only of steps counts through them. A Circuit of 3 rounds has each step 3 times.
	// What was done there with another Task, before its Slot was swapped, counts for it too.
	for (const s of slots) {
		if (!isStep(s, s.metrics.length)) continue;
		total++;
		if ([...(at.get(s.path) ?? []), ...orphans.filter((e) => e.path === s.path)].some((e) => !(e.values._summary === true && Object.keys(e.values).length === 1))) done++;
	}
	if (total < 2) return null;
	if (!entries.length) return null;
	return { kind: 'steps', done, total };
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** "3 of 6 glasses", "2 of 4 steps"; "4 of at most 5 cigarettes" where less is better. */
export function progressText(p: Progress): string {
	if (p.kind === 'steps') return `${p.done} of ${p.total} steps`;
	return `${fmt(p.value)} of ${p.less ? 'at most ' : ''}${fmt(p.target)}${p.unit ? ` ${p.unit}` : ''}`;
}

/** A value meets its target: at least it, or at most it where less is better. */
export const meets = (value: number, target: number, less: boolean) => (less ? value <= target : value >= target);

/** Whether a log fell short (or went over a most): worth showing next to "Done". */
export const isPartial = (p: Progress | null | undefined): boolean =>
	!!p && (p.kind === 'steps' ? p.done < p.total : !meets(p.value, p.target, p.less));

/** A Minimum that asks less than the Target: lower, or higher where less is better. */
export const easierThan = (minimum: number, target: number, less: boolean) => (less ? minimum > target : minimum < target);

/**
 * How a log counts for its day under the habit's rule:
 * - `full`: it reached the target (every step done), or there is nothing to measure it by. Where
 *   less is better, at or under the target is full, the Minimum sits above it.
 * - `counts`: it fell short, but reached the Minimum (any log, when the habit has no Minimum),
 *   and the habit lets that count.
 * - `short`: it doesn't count: below the Minimum, or the habit counts only the full target.
 * `atMinimum` is the progress against the Minimum, given only when the habit has one.
 */
export type Verdict = 'full' | 'counts' | 'short';

export function verdict(atTarget: Progress | null, atMinimum: Progress | null | undefined, minimumCounts: boolean): Verdict {
	if (!atTarget || !isPartial(atTarget)) return 'full';
	if (!minimumCounts) return 'short';
	if (atMinimum) return isPartial(atMinimum) ? 'short' : 'counts';
	// Over a most with no Minimum to fall back on doesn't count: only some of a least does.
	if (atTarget.kind === 'amount' && atTarget.less) return 'short';
	return (atTarget.kind === 'steps' ? atTarget.done : atTarget.value) > 0 ? 'counts' : 'short';
}
