// Due days nobody logged. Once a due day is over with no log it counts as missed, unless the
// habit is set to ignore days you don't log. Pure functions, so the rules can be tested
// without a database; the server writes the misses as Occurrences (see server/today.ts).
import { addDays, daysBetween, weekStart, type ISODate } from './dates';
import { dueOn, type Done, type Rotation, type Schedule } from './schedule';

/** What a due day that ends with no log counts as. A per-habit setting. */
export type Unlogged = 'missed' | 'ignore';

/** One Occurrence of the habit, whatever its status. */
export interface DayRow {
	date: ISODate;
	status: 'due' | 'done' | 'skipped' | 'missed';
	variantId: string | null;
	extra?: boolean;
}

export interface Miss {
	date: ISODate;
	variantId: string | null;
}

const lastOfMonth = (d: ISODate): ISODate => {
	const y = Number(d.slice(0, 4));
	const m = Number(d.slice(5, 7));
	return `${d.slice(0, 8)}${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

/**
 * Sessions a period asks for. A first period that began part way through asks for its share,
 * rounded down: "4 a week" started on a Sunday owes nothing that week, on a Thursday 2.
 */
function owed(times: number, p: { from: ISODate; to: ISODate }, lo: ISODate): number {
	if (lo <= p.from) return times;
	return Math.floor((times * (daysBetween(lo, p.to) + 1)) / (daysBetween(p.from, p.to) + 1));
}

/** The week or month a date falls in. */
function periodOf(d: ISODate, period: 'week' | 'month'): { from: ISODate; to: ISODate } {
	if (period === 'week') return { from: weekStart(d), to: addDays(weekStart(d), 6) };
	return { from: `${d.slice(0, 8)}01`, to: lastOfMonth(d) };
}

/**
 * A rotation that waits: the Variant stays due until it is done. Each time its gap (the rest
 * days before it, plus one) comes round again without it, that is one more missed session.
 */
function waitingMiss(s: Rotation, last: Done | undefined, d: ISODate): string | null {
	const n = s.order.length;
	if (!n) return null;
	const li = last ? s.order.findIndex((o) => o.variantId === last.variantId) : -1;
	const dueFrom = last && li >= 0 ? addDays(last.date, s.order[li].restDays + 1) : s.start;
	if (d < dueFrom) return null;
	const gap = (li >= 0 ? s.order[li] : s.order[n - 1]).restDays + 1;
	return daysBetween(dueFrom, d) % gap === 0 ? s.order[(li + 1) % n].variantId : null;
}

/**
 * Due days from `from` to `to` (both inclusive; `to` is normally yesterday) with no
 * Occurrence that weren't paused: each one is a miss. Nothing before the habit's `start`.
 *
 * - Fixed schedules (weekdays, every N days, a weekly rotation, a rotation that skips ahead):
 *   every due day with no log.
 * - N times a week or month: a period that ended short counts each missing session, placed
 *   on the last free days of the period. A skip counts as a session; so does a miss already
 *   written, so running this twice adds nothing.
 * - A rotation that waits: see waitingMiss.
 */
export function missedDays(
	schedule: Schedule,
	rows: DayRow[],
	start: ISODate,
	from: ISODate,
	to: ISODate,
	paused: (d: ISODate) => boolean = () => false
): Miss[] {
	if (from < start) from = start;
	if (from > to) return [];
	const taken = new Set(rows.map((r) => r.date));
	const free = (d: ISODate) => !taken.has(d) && !paused(d);
	const out: Miss[] = [];

	if (schedule.kind === 'frequency') {
		// Every period whose last day falls between `from` and `to`.
		for (let p = periodOf(from, schedule.period); p.from <= to; p = periodOf(addDays(p.to, 1), schedule.period)) {
			if (p.to < from || p.to > to) continue;
			const lo = p.from < start ? start : p.from;
			let open = 0;
			for (let d = lo; d <= p.to; d = addDays(d, 1)) if (!paused(d)) open++;
			const counted = rows.filter((r) => r.date >= p.from && r.date <= p.to && r.status !== 'due').length;
			let missing = Math.min(owed(schedule.times, p, lo), open) - counted;
			for (let d = p.to; missing > 0 && d >= lo; d = addDays(d, -1)) {
				if (!free(d)) continue;
				out.push({ date: d, variantId: schedule.variantId });
				missing--;
			}
		}
		return out.sort((a, b) => a.date.localeCompare(b.date));
	}

	const acted: Done[] = rows
		.filter((r) => r.status === 'done' || r.status === 'skipped')
		.map((r) => ({ date: r.date, variantId: r.variantId, status: r.status as Done['status'], extra: r.extra }))
		.sort((a, b) => a.date.localeCompare(b.date));
	const byVariant = schedule.kind === 'rotation' && schedule.step === 'variant';
	const skipAhead = byVariant && schedule.onMiss === 'skip';
	let i = 0;
	for (let d = from; d <= to; d = addDays(d, 1)) {
		while (i < acted.length && acted[i].date < d) i++;
		if (!free(d)) continue;
		// Only the last Variant acted on matters to a rotation; other schedules ignore history.
		let last: Done | undefined;
		if (byVariant)
			for (let j = i - 1; j >= 0; j--)
				if (acted[j].variantId !== null && !(skipAhead && acted[j].extra)) {
					last = acted[j];
					break;
				}
		const v =
			byVariant && !skipAhead
				? waitingMiss(schedule as Rotation, last, d)
				: dueOn(schedule, last ? [last] : [], d);
		if (v) out.push({ date: d, variantId: v });
	}
	return out;
}

/**
 * After a past day changes, the misses of a schedule that carries over can change too: a
 * weekly target met late, a waiting rotation done on another day. The date to count them
 * again from, or null when each day's miss stands on its own.
 */
export function recountFrom(s: Schedule, date: ISODate): ISODate | null {
	if (s.kind === 'frequency') return periodOf(date, s.period).from;
	if (s.kind === 'rotation' && s.step === 'variant' && s.onMiss === 'wait') return date;
	return null;
}

/**
 * Move a schedule's own start back so it begins no later than `date`, for a habit whose start
 * date moved back. Every N days and a weekly rotation move by whole cycles, so the days already
 * planned keep their Variant. Schedules without a start are returned as they are.
 */
export function scheduleStartBy<S extends Schedule>(s: S, date: ISODate): S {
	if (!('start' in s) || !s.start || s.start <= date) return s;
	const back = daysBetween(date, s.start);
	const cycle = cycleOf(s);
	return cycle ? { ...s, start: addDays(s.start, -Math.ceil(back / cycle) * cycle) } : { ...s, start: date };
}

/**
 * Days before a schedule repeats itself, or null when it has no fixed cycle. A rotation by
 * Variant goes round once in the sum of its Variants and their rest days (a 12-day roster).
 */
export function cycleOf(s: Schedule): number | null {
	if (s.kind === 'interval') return Math.max(1, s.every);
	if (s.kind === 'rotation' && s.step === 'week') return 7 * Math.max(1, s.order.length);
	if (s.kind === 'rotation' && s.order.length) return s.order.reduce((n, o) => n + Math.max(0, o.restDays) + 1, 0);
	return null;
}

/**
 * A schedule the habit had before an edit that applies from a later day on: it still decides
 * which days up to `until` (inclusive) were due, so history keeps the plan it had.
 */
export interface EarlierSchedule {
	until: ISODate;
	schedule: Schedule;
}

/** The schedule in force on a day: the earliest earlier one that still covers it, else the current. */
export function scheduleOn<S extends Schedule>(current: S, earlier: EarlierSchedule[] | null | undefined, date: ISODate): S {
	for (const e of earlier ?? []) if (date <= e.until) return e.schedule as S;
	return current;
}

/**
 * Stretches of days that share one schedule, from `from` to `to` (inclusive), oldest first.
 */
export function scheduleSpans(
	current: Schedule,
	earlier: EarlierSchedule[] | null | undefined,
	from: ISODate,
	to: ISODate
): { from: ISODate; to: ISODate; schedule: Schedule }[] {
	const out: { from: ISODate; to: ISODate; schedule: Schedule }[] = [];
	let lo = from;
	for (const e of [...(earlier ?? [])].sort((a, b) => a.until.localeCompare(b.until))) {
		if (lo > to) break;
		if (e.until < lo) continue;
		const hi = e.until < to ? e.until : to;
		out.push({ from: lo, to: hi, schedule: e.schedule });
		lo = addDays(hi, 1);
	}
	if (lo <= to) out.push({ from: lo, to, schedule: current });
	return out;
}

/** missedDays over a stretch where the schedule changed: each day is judged by the plan it had. */
export function missedDaysOver(
	current: Schedule,
	earlier: EarlierSchedule[] | null | undefined,
	rows: DayRow[],
	start: ISODate,
	from: ISODate,
	to: ISODate,
	paused: (d: ISODate) => boolean = () => false
): Miss[] {
	return scheduleSpans(current, earlier, from < start ? start : from, to).flatMap((s) =>
		missedDays(s.schedule, rows, start, s.from, s.to, paused)
	);
}

/**
 * The earlier schedules after an edit that applies from `today` on: the old schedule keeps the
 * days up to yesterday. Days already kept by an earlier entry stay with it.
 */
export function keepEarlier(
	earlier: EarlierSchedule[] | null | undefined,
	old: Schedule,
	startDate: ISODate,
	today: ISODate
): EarlierSchedule[] | null {
	const list = [...(earlier ?? [])];
	const yesterday = addDays(today, -1);
	const last = list.at(-1)?.until;
	if (yesterday >= startDate && (!last || last < yesterday)) list.push({ until: yesterday, schedule: old });
	return list.length ? list.slice(-50) : null;
}

/** JSON with object keys in order, so two schedules built in different ways compare equal. */
const canon = (v: unknown): unknown =>
	Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)])) : v;

/** Whether two schedules plan the same days. */
export const sameSchedule = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
