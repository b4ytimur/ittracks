// Logging past days: which dates can still be logged, and which Variant a past day gets.
// Pure functions, so the rules can be tested without a database.
import { addDays, daysBetween, weekday, weekStart, type ISODate } from './dates';
import { dueOn, nextInRotation, phaseOn, phaseSpans, planOn, type Done, type ParentDue, type Schedule } from './schedule';

/**
 * How far back past days can be logged: null is any time, 0 is off, N is up to N days back
 * (1 = yesterday only). A Settings option.
 */
export type PastDays = number | null;

/** The choices offered in Settings. */
export const PAST_DAYS_CHOICES: { value: PastDays; label: string }[] = [
	{ value: null, label: 'Any time' },
	{ value: 30, label: 'Up to a month back' },
	{ value: 7, label: 'Up to a week back' },
	{ value: 3, label: 'Up to 3 days back' },
	{ value: 1, label: 'Yesterday only' },
	{ value: 0, label: 'Off: only today can be logged' }
];

export type LogWindow = 'ok' | 'today' | 'future' | 'off' | 'tooOld';

/**
 * Can a build habit still be marked done or skipped on `date`? `today` is the user's
 * logical today (after the day start), so with a 04:00 start "yesterday" at 01:30 is
 * two calendar days back.
 */
export function logWindow(date: ISODate, today: ISODate, pastDays: PastDays): LogWindow {
	if (date === today) return 'today';
	if (date > today) return 'future';
	if (pastDays === 0) return 'off';
	if (pastDays !== null && daysBetween(date, today) > pastDays) return 'tooOld';
	return 'ok';
}

/** The earliest date that can be logged, or null when there is no limit. */
export function earliestLoggable(today: ISODate, pastDays: PastDays): ISODate | null {
	return pastDays === null ? null : addDays(today, -pastDays);
}

/** A real calendar date written as YYYY-MM-DD. */
export function isRealDate(v: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
	const t = Date.parse(`${v}T00:00:00Z`);
	return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/**
 * Schedules whose missed days don't exist: a frequency target and a rotation that waits
 * carry the habit over to the next day instead.
 */
export function carriesOver(s: Schedule, date?: ISODate): boolean {
	// Phases: the phase in force that day. With no day, the whole habit carries over only
	// when every phase does.
	if (s.kind === 'phases') return date ? carriesOver(planOn(s, date)) : s.phases.every((p) => carriesOver(p.schedule));
	return s.kind === 'frequency' || (s.kind === 'rotation' && s.step === 'variant' && s.onMiss === 'wait');
}

/** Schedules where what is due depends on what was done before: a past log can change today. */
export function dependsOnHistory(s: Schedule, date?: ISODate): boolean {
	// Phases: the phase in force that day, or with no day, any phase.
	if (s.kind === 'phases') return date ? dependsOnHistory(planOn(s, date)) : s.phases.some((p) => dependsOnHistory(p.schedule));
	return s.kind === 'frequency' || (s.kind === 'rotation' && s.step === 'variant');
}

/**
 * The Variant a past day is logged with: the one the schedule had due that day, or, on a
 * day nothing was due, the one that would have come next. `history` holds only what was
 * acted on before `date`.
 */
export function variantFor(s: Schedule, history: Done[], date: ISODate, variantIds: string[], parentDue?: ParentDue): string | null {
	const due = dueOn(s, history, date, parentDue);
	if (due) return due;
	switch (s.kind) {
		case 'phases': {
			// The phase the day falls in; before the first, the first; after the last, the last.
			const spans = phaseSpans(s);
			const p = phaseOn(s, date) ?? (date < s.start ? spans[0] : spans.at(-1));
			if (!p) break;
			return variantFor(p.schedule, history.filter((h) => h.date >= p.from), date, variantIds);
		}
		case 'weekly': {
			// The Variant of the closest scheduled weekday before this one.
			for (let back = 1; back <= 7; back++) {
				const v = s.days[(weekday(date) - back + 7) % 7];
				if (v) return v;
			}
			break;
		}
		case 'frequency':
		case 'interval':
		case 'follow':
			return s.variantId;
		case 'rotation':
			if (s.order.length === 0) break;
			if (s.step === 'week') {
				const weeks = Math.floor(daysBetween(weekStart(s.start), weekStart(date)) / 7);
				return s.order[((weeks % s.order.length) + s.order.length) % s.order.length].variantId;
			}
			return nextInRotation(s, history, date)?.variantId ?? s.order[0].variantId;
	}
	return variantIds[0] ?? null;
}

/**
 * "Last time" for an Occurrence, from finished ones sorted newest first: the latest on or
 * before its date, so a past day logged late copies the session before it, not a newer
 * one. With nothing that early, the newest one. Never the Occurrence itself.
 */
export function lastTimeFor<T extends { id: string; date: ISODate }>(
	newestFirst: T[],
	occ: { id: string; date: ISODate } | undefined
): T | undefined {
	const others = newestFirst.filter((o) => o.id !== occ?.id);
	return (occ ? others.find((o) => o.date <= occ.date) : undefined) ?? others[0];
}
