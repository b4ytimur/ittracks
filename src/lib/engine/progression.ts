// Habit shaping: after N Occurrences in a row at Target or better, suggest raising the targets.
import type { Mark } from './streak';
import type { ISODate } from './dates';

export interface Progression {
	/** Occurrences in a row at Target or Stretch before suggesting a raise. */
	after: number;
	/** How much to raise: a percentage, or a fixed amount added to each target. */
	by: number;
	unit: 'percent' | 'amount';
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

/** Raise a set of targets. Whole-number targets stay whole; others keep one decimal. */
export function raise(targets: Record<string, number>, p: Progression): Record<string, number> {
	return Object.fromEntries(
		Object.entries(targets).map(([k, v]) => {
			const next = p.unit === 'percent' ? v * (1 + p.by / 100) : v + p.by;
			const rounded = Number.isInteger(v) && p.unit === 'percent' ? Math.round(next) : Math.round(next * 10) / 10;
			return [k, rounded === v && p.by > 0 ? v + (Number.isInteger(v) ? 1 : 0.1) : rounded];
		})
	);
}
