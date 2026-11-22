// Schedule rules from the MVP spec. Pure functions, no database access,
// so they can be tested in isolation and reused on the server and in the browser.
import { addDays, daysBetween, toDays, weekday, weekStart, type ISODate } from './dates';

/** Weekdays are 0 = Monday ... 6 = Sunday. */
export type Schedule =
	| ({ kind: 'weekly'; days: Partial<Record<string, string>> } & Routine)
	| ({ kind: 'frequency'; times: number; period: 'week' | 'month'; variantId: string } & Routine)
	| (Rotation & Routine)
	| ({ kind: 'interval'; every: number; start: ISODate; variantId: string } & Routine)
	| GroupRule
	| Follow;

/**
 * How a habit with habits inside it judges its day from theirs (see engine/rollup.ts):
 * `target` null means all of them; `minimum` is how many make a day done at the Minimum, or
 * null for no Minimum.
 */
export interface RollupRule {
	target: number | null;
	minimum: number | null;
}

/**
 * A group of habits has no days of its own: it is due when a habit inside it is due, and done
 * when enough of them are done.
 */
export interface GroupRule extends RollupRule {
	kind: 'group';
}

/**
 * A routine is a habit with its own schedule and habits inside it: on its days, it is judged
 * from theirs by this rule. Absent means all of them, with no Minimum.
 */
interface Routine {
	rollup?: RollupRule;
}

/**
 * A habit inside a routine that is due whenever the routine is: on every one of its days, or
 * only when the routine's Variant is one of `on`. It logs its own Variant, `variantId`.
 */
export interface Follow {
	kind: 'follow';
	variantId: string;
	on: string[] | null;
}

export const isGroup = (s: { kind: string } | null | undefined): s is GroupRule => s?.kind === 'group';
export const isFollow = (s: { kind: string } | null | undefined): s is Follow => s?.kind === 'follow';

/** The rule a habit with habits inside it judges its day by. */
export function rollupRuleOf(s: Schedule | null | undefined): RollupRule {
	if (!s || isFollow(s)) return { target: null, minimum: null };
	if (isGroup(s)) return { target: s.target, minimum: s.minimum };
	return s.rollup ?? { target: null, minimum: null };
}

/**
 * For a habit that follows its parent: the Variant the parent has due on a date, or null when
 * nothing of it is due then. An empty string means due, with no Variant known.
 */
export type ParentDue = (date: ISODate) => string | null;

/**
 * Rotation by Variant: Variants in order, each followed by its rest days.
 * Rotation by week: one Variant per week, on the chosen weekdays; restDays and onMiss are unused.
 */
export interface Rotation {
	kind: 'rotation';
	step: 'variant' | 'week';
	order: { variantId: string; restDays: number }[];
	/** What a missed day does: wait keeps it due, skip moves on. */
	onMiss: 'wait' | 'skip';
	weekdays: number[];
	start: ISODate;
}

/** A past Occurrence that was acted on. */
export interface Done {
	date: ISODate;
	variantId: string | null;
	status: 'done' | 'skipped';
	/** Logged on a day nothing was due. A rotation that skips ahead follows its calendar past it. */
	extra?: boolean;
}

/**
 * The Variant due on `date`, or null when nothing is due. A habit that follows its parent
 * needs `parentDue`; without it, it is never due.
 */
export function dueOn(schedule: Schedule, history: Done[], date: ISODate, parentDue?: ParentDue): string | null {
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

		case 'group':
			// Its days come from the habits inside it, never from the schedule.
			return null;

		case 'follow': {
			const p = parentDue?.(date) ?? null;
			if (p === null) return null;
			return !schedule.on || schedule.on.includes(p) ? schedule.variantId : null;
		}
	}
}

function weekRotationDue(
	s: Rotation,
	date: ISODate
): string | null {
	if (date < s.start || !s.weekdays.includes(weekday(date)) || s.order.length === 0) return null;
	const weeks = Math.floor(daysBetween(weekStart(s.start), weekStart(date)) / 7);
	return s.order[weeks % s.order.length].variantId;
}

/** The next Variant in a rotation and the first date it is due. */
export function nextInRotation(
	s: Rotation,
	history: Done[],
	today: ISODate
): { variantId: string; dueFrom: ISODate } | null {
	const n = s.order.length;
	if (n === 0) return null;

	// Start from the last Variant acted on before today, or from the beginning. A rotation that
	// skips ahead runs like a roster, so a log on a day off is an extra and doesn't move it.
	const last = history
		.filter((h) => h.date < today && h.variantId !== null && !(s.onMiss === 'skip' && h.extra))
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
	s: Rotation,
	history: Done[],
	date: ISODate
): string | null {
	const next = nextInRotation(s, history, date);
	if (!next) return null;
	// Wait mode: due on and after its date. Skip mode: due only on its date.
	const due = s.onMiss === 'wait' ? date >= next.dueFrom : date === next.dueFrom;
	return due ? next.variantId : null;
}
