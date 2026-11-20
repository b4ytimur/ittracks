import { daysBetween, type ISODate } from './dates';

export type OccurrenceStatus = 'due' | 'done' | 'skipped' | 'missed';

/**
 * Build-habit streak: consecutive done or skipped Occurrences, counted back
 * from the most recent. A missed one ends the streak; due ones are ignored.
 */
export function buildStreak(statuses: OccurrenceStatus[]): number {
	let streak = 0;
	for (let i = statuses.length - 1; i >= 0; i--) {
		const s = statuses[i];
		if (s === 'due') continue;
		if (s === 'missed') break;
		streak++;
	}
	return streak;
}

/** Break habit: whole days since the last Slip, or since the start if none. */
export function daysSinceSlip(slipDates: ISODate[], start: ISODate, today: ISODate): number {
	const last = [...slipDates].filter((d) => d <= today).sort().at(-1);
	return daysBetween(last ?? start, today);
}

/** Break habit: the longest run of slip-free days between start and today. */
export function longestRun(slipDates: ISODate[], start: ISODate, today: ISODate): number {
	const points = [start, ...[...new Set(slipDates)].filter((d) => d <= today).sort(), today];
	let best = 0;
	for (let i = 1; i < points.length; i++) {
		// The counter reads its highest on the day of the next slip, before it resets, or today.
		best = Math.max(best, daysBetween(points[i - 1], points[i]));
	}
	return best;
}
