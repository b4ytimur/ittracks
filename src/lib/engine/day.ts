// The user's day: when it starts, and its named parts ("Morning 05:00 to 11:00").
import { addDays, type ISODate } from './dates';

/** A named part of the day. Ranges may wrap past midnight: 22:00 to 04:00. */
export interface DayRange {
	name: string;
	/** HH:MM */
	start: string;
	/** HH:MM, exclusive */
	end: string;
}

export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * The date a moment belongs to when the day starts at `dayStart`, given the calendar
 * date and clock time there. With a 04:00 start, 01:30 on the 5th still counts as the 4th.
 */
export function logicalDate(calendarDate: ISODate, clock: string, dayStart = '00:00'): ISODate {
	return minutesOf(clock) < minutesOf(dayStart) ? addDays(calendarDate, -1) : calendarDate;
}

/** Is a clock time inside a range? */
export function inRange(r: DayRange, clock: string): boolean {
	const t = minutesOf(clock);
	const a = minutesOf(r.start);
	const b = minutesOf(r.end);
	return a <= b ? t >= a && t < b : t >= a || t < b;
}

/** The first range a clock time falls in, or null. */
export function rangeAt(ranges: DayRange[], clock: string): DayRange | null {
	return ranges.find((r) => inRange(r, clock)) ?? null;
}

/**
 * Minutes from the start of the user's day, so habits sort in the order the day is lived:
 * with a 04:00 start, 23:00 comes before 01:00.
 */
export function dayOrder(clock: string, dayStart = '00:00'): number {
	return (minutesOf(clock) - minutesOf(dayStart) + 1440) % 1440;
}

/** Suggested ranges, offered during setup. */
export const DEFAULT_RANGES: DayRange[] = [
	{ name: 'Morning', start: '05:00', end: '11:00' },
	{ name: 'Afternoon', start: '11:00', end: '17:00' },
	{ name: 'Evening', start: '17:00', end: '22:00' },
	{ name: 'Night', start: '22:00', end: '05:00' }
];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A part of the day named twice in a form (case doesn't count), or null. Saving would keep
 * only the first and move the other's habits to it, so the form is refused instead.
 */
export function duplicateRange(f: FormData): string | null {
	const seen = new Set<string>();
	for (const raw of f.getAll('rangeName').map(String)) {
		const n = raw.trim().slice(0, 40).toLowerCase();
		if (!n) continue;
		if (seen.has(n)) return raw.trim();
		seen.add(n);
	}
	return null;
}

/** Ranges posted as rangeName/rangeStart/rangeEnd fields; incomplete rows and repeated names are dropped. */
export function readRanges(f: FormData): DayRange[] {
	const names = f.getAll('rangeName').map(String);
	const starts = f.getAll('rangeStart').map(String);
	const ends = f.getAll('rangeEnd').map(String);
	return names
		.map((n, i) => ({ name: n.trim().slice(0, 40), start: starts[i] ?? '', end: ends[i] ?? '' }))
		.filter((r) => r.name && HHMM.test(r.start) && HHMM.test(r.end) && r.start !== r.end)
		.filter((r, i, all) => all.findIndex((x) => x.name.toLowerCase() === r.name.toLowerCase()) === i)
		.slice(0, 12);
}
