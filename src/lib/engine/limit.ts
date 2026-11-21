// Reduce mode for break habits: a daily or weekly limit, optionally tapering down over time.
import { daysBetween, addDays, weekStart, type ISODate } from './dates';

export interface Limit {
	max: number;
	period: 'day' | 'week';
	/** Lower the limit by `by` every week or month, counted from `start`, never below 0. */
	taper: { by: number; every: 'week' | 'month'; floor?: number } | null;
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
	return Math.max(Math.min(l.taper.floor ?? 0, l.max), l.max - steps * l.taper.by);
}

/** The next date the limit drops, and to what, within the next ~2 months. */
export function nextDrop(l: Limit, today: ISODate): { date: ISODate; max: number } | null {
	if (!l.taper) return null;
	const now = limitOn(l, today);
	for (let i = 1; i <= 62; i++) {
		const d = addDays(today, i);
		const m = limitOn(l, d);
		if (m < now) return { date: d, max: m };
	}
	return null;
}

const periodStart = (l: Limit, d: ISODate) => (l.period === 'week' ? weekStart(d) : d);

/** Slips counted in the period that contains `date`. */
export function usedIn(l: Limit, slips: { date: ISODate; count: number }[], date: ISODate): number {
	const from = periodStart(l, date);
	const to = l.period === 'week' ? addDays(from, 6) : from;
	return slips.filter((s) => s.date >= from && s.date <= to).reduce((n, s) => n + s.count, 0);
}

/**
 * Did the slips logged on `date` stay within the limit? For a weekly limit this counts the
 * week's slips up to and including that day: days before the week goes over are within
 * the limit, and the day that goes over (and any later day with slips that week) is not.
 */
export function withinOn(l: Limit, slips: { date: ISODate; count: number }[], date: ISODate): boolean {
	const from = periodStart(l, date);
	const used = slips.filter((s) => s.date >= from && s.date <= date).reduce((n, s) => n + s.count, 0);
	return used <= limitOn(l, from);
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
