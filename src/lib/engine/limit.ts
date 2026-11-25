// Reduce mode for break habits: a daily or weekly limit, optionally tapering down over time.
import { daysBetween, addDays, weekStart, type ISODate } from './dates';

interface Plan {
	max: number;
	period: 'day' | 'week';
	/** Lower the limit by `by` every week or month, counted from `start`, never below 0. */
	taper: { by: number; every: 'week' | 'month'; floor?: number } | null;
	start: ISODate;
}
export interface Limit extends Plan {
	/** What it was before it was changed, oldest first: past days keep the limit they had. */
	earlier?: (Plan & { through: ISODate })[];
}

const sameLimit = (a: Pick<Plan, 'max' | 'period' | 'taper'>, b: Pick<Plan, 'max' | 'period' | 'taper'>) =>
	a.max === b.max && a.period === b.period && a.taper?.by === b.taper?.by && a.taper?.every === b.taper?.every && (a.taper?.floor ?? 0) === (b.taper?.floor ?? 0);

/** A changed limit or taper applies from today; the days before keep the one they had. */
export function changeLimit(before: Limit | null | undefined, next: Pick<Plan, 'max' | 'period' | 'taper'>, today: ISODate): Limit {
	const { max, period, taper } = next;
	if (!before) return { max, period, taper, start: today };
	if (sameLimit(before, next)) return before;
	const earlier = before.earlier ?? [];
	if (before.start < today) {
		const { earlier: _, ...was } = before;
		return { max, period, taper, start: today, earlier: [...earlier, { ...was, through: addDays(today, -1) }] };
	}
	// Changed again the same day, perhaps back to what it was yesterday.
	const last = earlier.at(-1);
	if (last && sameLimit(last, next)) {
		const { through: _, ...was } = last;
		return { ...was, ...(earlier.length > 1 ? { earlier: earlier.slice(0, -1) } : {}) };
	}
	return { max, period, taper, start: before.start, ...(earlier.length ? { earlier } : {}) };
}

/** The limit a date goes by: today's, or the one it had then. */
export const planOn = (l: Limit, date: ISODate): Plan => l.earlier?.find((e) => date <= e.through) ?? l;

/** The limit that applies on a date. */
export const limitOn = (l: Limit, date: ISODate): number => maxOn(planOn(l, date), date);

function maxOn(l: Plan, date: ISODate): number {
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

const periodStart = (l: Plan, d: ISODate) => (l.period === 'week' ? weekStart(d) : d);

/** Slips counted in the period that contains `date`, by the limit it had. */
export function usedIn(l: Limit, slips: { date: ISODate; count: number }[], date: ISODate): number {
	const p = planOn(l, date);
	const from = periodStart(p, date);
	const to = p.period === 'week' ? addDays(from, 6) : from;
	return slips.filter((s) => s.date >= from && s.date <= to).reduce((n, s) => n + s.count, 0);
}

/**
 * Did the slips logged on `date` stay within the limit? For a weekly limit this counts the
 * week's slips up to and including that day: days before the week goes over are within
 * the limit, and the day that goes over (and any later day with slips that week) is not.
 */
export function withinOn(l: Limit, slips: { date: ISODate; count: number }[], date: ISODate): boolean {
	const p = planOn(l, date);
	const from = periodStart(p, date);
	const used = slips.filter((s) => s.date >= from && s.date <= date).reduce((n, s) => n + s.count, 0);
	return used <= maxOn(p, from);
}

/** Was every day of the day or week that starts on `from` within the limit it had? */
export const periodWithin = (l: Limit, slips: { date: ISODate; count: number }[], from: ISODate): boolean =>
	Array.from({ length: l.period === 'week' ? 7 : 1 }, (_, i) => addDays(from, i)).every((d) => withinOn(l, slips, d));

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
		if (!periodWithin(l, slips, d)) break;
		n++;
		d = addDays(d, -step);
	}
	return n;
}
