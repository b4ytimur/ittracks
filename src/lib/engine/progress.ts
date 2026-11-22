// How far along a log is: "3 of 6 glasses" for a habit with one number to reach, or
// "2 of 4 steps" for one made of several Tasks, sub-tasks and Yes or no ticks.
// Shown on Today, the past-day page and History, so a partial day doesn't read as plain "Done".

export interface ProgressMetric {
	id: string;
	name: string;
	type: string;
	unit: string | null;
	repeats: boolean;
	step: number | null;
}

export interface ProgressSlot {
	taskId: string | null;
	metrics: ProgressMetric[];
	subtaskIds: string[];
	/** Targets at the log's level (falling back to Target), by Metric id. */
	targets: Record<string, number>;
}

export interface ProgressEntry {
	taskId: string;
	values: Record<string, unknown>;
}

export type Progress =
	/** One number to reach, such as glasses of water or minutes read. */
	| { kind: 'amount'; value: number; target: number; unit: string; name: string; taskId: string; metricId: string; type: string; step: number | null }
	/** Several things to do, each one a step: a Task logged, a sub-task or a Yes or no Task ticked. */
	| { kind: 'steps'; done: number; total: number };

const numeric = (t: string) => t === 'number' || t === 'count' || t === 'duration';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The single target a habit counts toward, when it has exactly one: one Task with one
 * once-per-log number that has a target, no sets and no sub-tasks. Other fields (a note,
 * a choice) may sit next to it.
 */
export function amountTarget(slots: ProgressSlot[]): { slot: ProgressSlot; metric: ProgressMetric; target: number } | null {
	const filled = slots.filter((s) => s.taskId);
	if (filled.length !== 1) return null;
	const s = filled[0];
	if (s.subtaskIds.length || s.metrics.some((m) => m.repeats)) return null;
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
			step: amount.metric.step
		};
	}
	const logged = new Set(entries.map((e) => e.taskId));
	let total = 0;
	let done = 0;
	for (const s of slots) {
		if (!s.taskId) continue;
		// The Task itself is a step when it has fields to fill in, or when it is a plain Yes or no.
		if (s.metrics.length || !s.subtaskIds.length) {
			total++;
			if (logged.has(s.taskId)) done++;
		}
		for (const id of s.subtaskIds) {
			total++;
			if (logged.has(id)) done++;
		}
	}
	if (total < 2) return null;
	if (!entries.length) return null;
	return { kind: 'steps', done, total };
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** "3 of 6 glasses", "2 of 4 steps". */
export function progressText(p: Progress): string {
	if (p.kind === 'steps') return `${p.done} of ${p.total} steps`;
	return `${fmt(p.value)} of ${fmt(p.target)}${p.unit ? ` ${p.unit}` : ''}`;
}

/** Whether a log fell short: worth showing next to "Done". */
export const isPartial = (p: Progress | null | undefined): boolean =>
	!!p && (p.kind === 'steps' ? p.done < p.total : p.value < p.target);

/**
 * How a log counts for its day under the habit's rule:
 * - `full`: it reached the target (every step done), or there is nothing to measure it by.
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
	return (atTarget.kind === 'steps' ? atTarget.done : atTarget.value) > 0 ? 'counts' : 'short';
}
