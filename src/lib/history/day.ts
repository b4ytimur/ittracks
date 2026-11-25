// A day in numbers and words, from one place, so a count, a mark and a streak's words can't disagree.

export interface DayLog {
	status: string;
	/** Logged on a day it wasn't due. */
	extra: boolean;
}

/** Done of what was due: a skip was not due, and a log on a day off changes nothing. */
export function dayCount(logs: DayLog[]): { done: number; of: number } {
	const due = logs.filter((o) => !o.extra && (o.status === 'done' || o.status === 'missed' || o.status === 'due'));
	return { done: due.filter((o) => o.status === 'done').length, of: due.length };
}

/** How a day looks in a strip: all done, some of it, none of it, only skipped, or nothing to say. */
export function dayMark(logs: DayLog[], today = false): 'done' | 'partial' | 'missed' | 'skipped' | 'due' | 'none' {
	const c = dayCount(logs);
	if (!c.of) return logs.some((o) => o.status === 'done') ? 'done' : logs.some((o) => o.status === 'skipped') ? 'skipped' : 'none';
	if (c.done === c.of) return 'done';
	if (c.done) return 'partial';
	return today ? 'due' : 'missed';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Mon 23 Nov": the strip's and headings' date; with the year when it isn't this one. */
export const dayTitle = (d: string, today: string) =>
	cap(new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(d.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }) }));
