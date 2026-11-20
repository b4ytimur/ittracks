// Reduce mode for break habits: a daily or weekly limit, optionally tapering down over time.
import { daysBetween, addDays, weekStart, type ISODate } from './dates';

export interface Limit {
	max: number;
	period: 'day' | 'week';
	/** Lower the limit by `by` every week or month, counted from `start`, never below 0. */
	taper: { by: number; every: 'week' | 'month' } | null;
	start: ISODate;
}

/** The limit that applies on a date. */
export function limitOn(l: Limit, date: ISODate): number {
	if (!l.taper || date < l.start) return l.max;
	const steps =
		l.taper.every === 'week'
			? Math.floor(daysBetween(l.start, date) / 7)
			: (Number(date.slice(0, 4)) - Number(l.start.slice(0, 4))) * 12 +
				Number(date.slice(5, 7)) -
				Number(l.start.slice(5, 7)) -
				(Number(date.slice(8, 10)) < Number(l.start.slice(8, 10)) ? 1 : 0);
	return Math.max(0, l.max - steps * l.taper.by);
}

const periodStart = (l: Limit, d: ISODate) => (l.period === 'week' ? weekStart(d) : d);

/** Slips counted in the period that contains `date`. */
export function usedIn(l: Limit, slips: { date: ISODate; count: number }[], date: ISODate): number {
	const from = periodStart(l, date);
	const to = l.period === 'week' ? addDays(from, 6) : from;
	return slips.filter((s) => s.date >= from && s.date <= to).reduce((n, s) => n + s.count, 0);
}

/**
 * Whole periods in a row within the limit, counted back from the last finished one.
 * The current period counts too while it is still within the limit.
 */
export function withinStreak(
	l: Limit,
	slips: { date: ISODate; count: number }[],
	start: ISODate,
	today: ISODate
): number {
	const step = l.period === 'week' ? 7 : 1;
	let n = 0;
	let d = periodStart(l, today);
	const first = periodStart(l, start);
	while (d >= first) {
		if (usedIn(l, slips, d) > limitOn(l, d)) break;
		n++;
		d = addDays(d, -step);
	}
	return n;
}
