// The days block and History's year strip: which days a span holds, how each day looks, and what it says.
import { addDays, daysBetween, weekStart, type ISODate } from '$lib/engine/dates';
import type { DAYS_SHOWS } from '$lib/views';

export type Show = (typeof DAYS_SHOWS)[number];
/** A day's [done, due]. */
export type Count = [done: number, of: number];
/** DayTile's meanings (day-tile.css): rest, future and before draw nothing there. */
export type Mark = 'done' | 'partial' | 'missed' | 'due' | 'rest' | 'future' | 'before';
/** The last 12 months: 52 weeks, this one last. */
export const YEAR_WEEKS = 52;

/** ISO week number: week 1 is the one holding 4 January. */
export const isoWeek = (d: ISODate): number => {
	const m = weekStart(d);
	return 1 + Math.floor(daysBetween(weekStart(`${addDays(m, 3).slice(0, 4)}-01-04`), m) / 7);
};
export const monthStart = (d: ISODate): ISODate => `${d.slice(0, 8)}01`;
export const addMonths = (d: ISODate, n: number): ISODate => {
	const m = Number(d.slice(5, 7)) - 1 + n;
	return `${Number(d.slice(0, 4)) + Math.floor(m / 12)}-${String((((m % 12) + 12) % 12) + 1).padStart(2, '0')}-01`;
};
export const monthEnd = (d: ISODate): ISODate => addDays(addMonths(d, 1), -1);
export const weekDays = (monday: ISODate): ISODate[] => Array.from({ length: 7 }, (_, i) => addDays(monday, i));
export const datesIn = (from: ISODate, to: ISODate): ISODate[] => Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i));
/** The Mondays of the weeks a month's days fall in: its rows. */
export function monthWeeks(at: ISODate): ISODate[] {
	const out: ISODate[] = [];
	for (let m = weekStart(monthStart(at)); m <= monthEnd(at); m = addDays(m, 7)) out.push(m);
	return out;
}
/** The first Monday of the last 12 months. */
export const yearStart = (today: ISODate): ISODate => addDays(weekStart(today), -7 * (YEAR_WEEKS - 1));

/** The days `show` puts on screen for `at`. The last 12 months always end with this week. */
export function spanOf(show: Show, at: ISODate, today: ISODate): [ISODate, ISODate] {
	if (show === 'seven') return [addDays(at, -6), at];
	if (show === 'month') return [monthStart(at), monthEnd(at)];
	if (show === 'year') return [yearStart(today), addDays(weekStart(today), 6)];
	return [weekStart(at), addDays(weekStart(at), 6)];
}

/** A step back (-1) or on (1): a month for a month, else a week; under the 12 months it moves the chosen week. */
export function stepOf(show: Show, at: ISODate, n: -1 | 1, today: ISODate): ISODate {
	if (show === 'month') return addMonths(at, n);
	const b = addDays(at, 7 * n);
	return show === 'seven' && b > today ? today : b;
}

/** Whether a step that way still shows something: not past this week, the month or today; not before the first day. */
export function canStep(show: Show, at: ISODate, n: -1 | 1, today: ISODate, first: ISODate | null): boolean {
	if (n === 1) return show === 'seven' ? at < today : show === 'month' ? monthEnd(at) < today : weekStart(at) < weekStart(today);
	const to = show === 'year' ? addDays(weekStart(stepOf(show, at, -1, today)), 6) : spanOf(show, stepOf(show, at, -1, today), today)[1];
	return first !== null && to >= first && (show !== 'year' || weekStart(at) > yearStart(today));
}

/** Whether `at` shows now: this week, this month, the seven days to the day the page is on (today on Today). */
export function showsNow(show: Show, at: ISODate, today: ISODate, chosen: ISODate | null = null): boolean {
	if (show === 'year') return weekStart(at) === weekStart(today);
	if (show === 'seven') return at === (chosen ?? today);
	const [a, b] = spanOf(show, at, today);
	return a <= today && today <= b;
}

export function markOf(d: ISODate, c: Count | undefined, today: ISODate, first: ISODate | null): Mark {
	if (d > today) return 'future';
	if (first === null || d < first) return 'before';
	const [done, of] = c ?? [0, 0];
	if (!of) return 'rest';
	return done >= of ? 'done' : done ? 'partial' : d === today ? 'due' : 'missed';
}

export const wordsOf = (m: Mark, c?: Count): string =>
	m === 'future' ? 'still to come' : m === 'before' ? 'before you started' : c && c[1] ? `${c[0]} of ${c[1]} done` : 'nothing due';

/** Today's rows that count, as dayCounts counts a day: a group or routine through the habits inside it, a log on a day off never. */
export const countedRows = <T extends { group: unknown; occurrence: { extra?: boolean } | null }>(rows: T[]): T[] => rows.filter((b) => !b.group && !b.occurrence?.extra);

/** A day's [done, due] from its habits' statuses, as dayCounts counts: a skip is neither. */
export const statusCount = (statuses: string[]): Count => [statuses.filter((s) => s === 'done').length, statuses.filter((s) => s !== 'skipped').length];

/**
 * Where History sends a day: to it in the list when the list draws it, to the list loaded back that far when it is
 * older than the list goes and something was due, else today to Today and any other day to its page.
 */
export function historyHref(d: ISODate, today: ISODate, listed: Set<string>, days: number, due: boolean, older: (days: number) => string): string {
	if (listed.has(d)) return `#d-${d}`;
	if (due && daysBetween(d, today) >= days) return `${older(daysBetween(d, today) + 1)}#d-${d}`;
	return d === today ? '/' : `/day/${d}`;
}

/** Done and due over some days. */
export function total(days: ISODate[], countOf: (d: ISODate) => Count | undefined): Count {
	return days.reduce<Count>((t, d) => ((c) => (c ? [t[0] + c[0], t[1] + c[1]] : t))(countOf(d)), [0, 0]);
}
