// A day in numbers and words, from one place, so a count, a mark and a streak's words can't disagree.
import { counts } from '../engine/scoring';

export interface DayLog {
	status: string;
	/** Logged on a day it wasn't due. */
	extra: boolean;
	/** A group's or routine's day, judged from the habits inside it (they are counted instead). */
	rollup?: unknown;
	/** Its habit's scoring: a tracker's log is never done or missed, so it counts neither way. */
	scoring?: string | null;
}

/**
 * Done of what was due: a skip was not due, a log on a day off changes nothing, a tracker's log
 * never counts, and a group or routine counts through the habits inside it, as Today and the Day
 * page count.
 */
export function dayCount(logs: DayLog[]): { done: number; of: number } {
	const due = logs.filter((o) => counts(o) && !o.extra && !o.rollup && (o.status === 'done' || o.status === 'missed' || o.status === 'due'));
	return { done: due.filter((o) => o.status === 'done').length, of: due.length };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Mon 23 Nov": a day's heading; with the year when it isn't this one. */
export const dayTitle = (d: string, today: string) =>
	cap(new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(d.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }) }));

interface Written {
	kind: string;
	habitId: string | null;
}
/**
 * Where a day's notes stand: the day's own first, a habit's under its row (a slip's under that habit's
 * last slip), and what has no row here, such as a log still open, after the rows.
 */
export function placeNotes<I extends Written>(items: I[], rows: { id: string; habitId: string }[], slips: { habitId: string }[]): { day: I[]; row: Map<string, I[]>; slip: Map<number, I[]>; rest: I[] } {
	const out = { day: [] as I[], row: new Map<string, I[]>(), slip: new Map<number, I[]>(), rest: [] as I[] };
	for (const it of items) {
		if (it.kind === 'day') {
			out.day.push(it);
			continue;
		}
		const at = it.kind === 'slip' ? slips.findLastIndex((x) => x.habitId === it.habitId) : -1;
		const row = it.kind === 'slip' ? undefined : rows.find((o) => o.habitId === it.habitId);
		if (at >= 0) out.slip.set(at, [...(out.slip.get(at) ?? []), it]);
		else if (row) out.row.set(row.id, [...(out.row.get(row.id) ?? []), it]);
		else out.rest.push(it);
	}
	return out;
}
