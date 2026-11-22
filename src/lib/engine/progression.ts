// Habit shaping: after N Occurrences in a row at Target or better, suggest raising the targets.
import type { Mark } from './streak';
import type { ISODate } from './dates';

export interface Progression {
	/** Occurrences in a row at Target or Stretch before suggesting a raise. */
	after: number;
	/**
	 * How much to raise: a percentage, or a number of steps. A step is each field's own +/-
	 * step, in its own unit (2.5 kg, 1 rep, 5 min), so one raise fits every target in a Slot.
	 */
	by: number;
	unit: 'percent' | 'steps';
}

/** Done at Target or Stretch, in a row from the newest, since `since` (exclusive). */
export function hitsInARow(marks: Mark[], since: ISODate | null): number {
	let n = 0;
	for (let i = marks.length - 1; i >= 0; i--) {
		const m = marks[i];
		if (since && m.date <= since) break;
		if (m.status === 'due' || m.status === 'skipped') continue;
		if (m.status === 'done' && m.level !== 'minimum') n++;
		else break;
	}
	return n;
}

export const shouldSuggest = (p: Progression, marks: Mark[], since: ISODate | null) =>
	hitsInARow(marks, since) >= p.after;

/**
 * Raise a set of targets. By percent: whole-number targets stay whole; others keep one decimal.
 * By steps: each target goes up by `by` of its own field's step (`steps`, by Metric id), so
 * 60 kg and 5 reps become 62.5 kg and 6 reps. A target with no known step is left as it is.
 * Old data says 'amount' for steps; anything that isn't percent is read as steps.
 */
export function raise(targets: Record<string, number>, p: Progression, steps: Record<string, number> = {}): Record<string, number> {
	return Object.fromEntries(
		Object.entries(targets).map(([k, v]) => {
			if (p.unit !== 'percent') {
				const step = steps[k];
				if (!step) return [k, v];
				const next = Math.round((v + p.by * step) * 1000) / 1000;
				// A count can't be 7.5: whole targets stay whole when the step is whole.
				return [k, Number.isInteger(v) && Number.isInteger(step) ? Math.round(next) : next];
			}
			const next = v * (1 + p.by / 100);
			const rounded = Number.isInteger(v) ? Math.round(next) : Math.round(next * 10) / 10;
			return [k, rounded === v && p.by > 0 ? v + (Number.isInteger(v) ? 1 : 0.1) : rounded];
		})
	);
}
