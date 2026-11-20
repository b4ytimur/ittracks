// Schedule rules from the MVP spec. Pure functions, no database access,
// so they can be tested in isolation and reused on the server and in the browser.
import { addDays, daysBetween, toDays, weekday, weekStart, type ISODate } from './dates';

/** Weekdays are 0 = Monday ... 6 = Sunday. */
export type Schedule =
	| { kind: 'weekly'; days: Partial<Record<number, string>> }
	| { kind: 'frequency'; times: number; period: 'week' | 'month'; variantId: string }
	| {
			kind: 'rotation';
			step: 'variant';
			/** Variants in order, each with the rest days that follow it. */
			order: { variantId: string; restDays: number }[];
			/** What a missed day does: wait keeps it due, skip moves on. */
			onMiss: 'wait' | 'skip';
			start: ISODate;
	  }
	| {
			kind: 'rotation';
			step: 'week';
			/** One Variant per week, cycling. */
			order: string[];
			weekdays: number[];
			start: ISODate;
	  }
	| { kind: 'interval'; every: number; start: ISODate; variantId: string };

/** A past Occurrence that was acted on. */
export interface Done {
	date: ISODate;
	variantId: string | null;
	status: 'done' | 'skipped';
}

/** The Variant due on `date`, or null when nothing is due. */
export function dueOn(schedule: Schedule, history: Done[], date: ISODate): string | null {
	switch (schedule.kind) {
		case 'weekly':
			return schedule.days[weekday(date)] ?? null;

		case 'interval': {
			const gap = daysBetween(schedule.start, date);
			return gap >= 0 && gap % schedule.every === 0 ? schedule.variantId : null;
		}

		case 'frequency': {
			const from = schedule.period === 'week' ? weekStart(date) : `${date.slice(0, 8)}01`;
			const count = history.filter(
				(h) => h.status === 'done' && h.date >= from && h.date < date
			).length;
			return count < schedule.times ? schedule.variantId : null;
		}

		case 'rotation':
			return schedule.step === 'week'
				? weekRotationDue(schedule, date)
				: variantRotationDue(schedule, history, date);
	}
}

function weekRotationDue(
	s: Extract<Schedule, { step: 'week' }>,
	date: ISODate
): string | null {
	if (date < s.start || !s.weekdays.includes(weekday(date)) || s.order.length === 0) return null;
	const weeks = Math.floor(daysBetween(weekStart(s.start), weekStart(date)) / 7);
	return s.order[weeks % s.order.length];
}

/** The next Variant in a rotation and the first date it is due. */
export function nextInRotation(
	s: Extract<Schedule, { step: 'variant' }>,
	history: Done[],
	today: ISODate
): { variantId: string; dueFrom: ISODate } | null {
	const n = s.order.length;
	if (n === 0) return null;

	// Start from the last Variant acted on before today, or from the beginning.
	const last = history
		.filter((h) => h.date < today && h.variantId !== null)
		.sort((a, b) => toDays(a.date) - toDays(b.date))
		.at(-1);
	const lastIndex = last ? s.order.findIndex((o) => o.variantId === last.variantId) : -1;

	let index = (lastIndex + 1) % n;
	let dueFrom =
		last && lastIndex >= 0 ? addDays(last.date, s.order[lastIndex].restDays + 1) : s.start;

	if (s.onMiss === 'skip') {
		// Every day a due Variant goes undone counts as missed, and the rotation moves on.
		while (dueFrom < today) {
			dueFrom = addDays(dueFrom, s.order[index].restDays + 1);
			index = (index + 1) % n;
		}
	}
	return { variantId: s.order[index].variantId, dueFrom };
}

function variantRotationDue(
	s: Extract<Schedule, { step: 'variant' }>,
	history: Done[],
	date: ISODate
): string | null {
	const next = nextInRotation(s, history, date);
	if (!next) return null;
	// Wait mode: due on and after its date. Skip mode: due only on its date.
	const due = s.onMiss === 'wait' ? date >= next.dueFrom : date === next.dueFrom;
	return due ? next.variantId : null;
}
