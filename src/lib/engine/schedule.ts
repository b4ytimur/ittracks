// Schedule rules from the MVP spec. Pure functions, no database access,
// so they can be tested in isolation and reused on the server and in the browser.
import { addDays, daysBetween, toDays, weekday, weekStart, type ISODate } from './dates';

/** Weekdays are 0 = Monday ... 6 = Sunday. */
export type Schedule = ((Plain | Phases) & Routine) | GroupRule | Follow;

/** A schedule that decides its days by itself, from the calendar and what was done. */
export type Plain =
	| { kind: 'weekly'; days: Partial<Record<string, string>> }
	| { kind: 'frequency'; times: number; period: 'week' | 'month'; variantId: string }
	| Rotation
	| { kind: 'interval'; every: number; start: ISODate; variantId: string };

/**
 * Schedules one after another, from `start`: "every day with Ramp-up for 1 week, then every
 * day with Maintain from then on". Each phase runs its own schedule as if it began on the
 * phase's first day, and only remembers what was done in that phase. Targets stay on the
 * Variants each phase uses. A list of phases is as expressive as phases inside phases, so a
 * phase holds a schedule with days of its own, never another list.
 */
export interface Phases {
	kind: 'phases';
	start: ISODate;
	phases: Phase[];
}

export interface Phase {
	/** How many `unit`s it runs; null runs on with no end. Phases after one with no end never come. */
	length: number | null;
	unit: 'day' | 'week';
	schedule: Plain;
}

/** A phase with the days it runs (`to` null: no end), its schedule moved to start on `from`. */
export interface PhaseSpan {
	index: number;
	from: ISODate;
	to: ISODate | null;
	schedule: Plain;
}

/** Nothing is ever due: before the first phase, and after the last one ends. */
export const NOTHING_DUE: Plain = { kind: 'weekly', days: {} };

export const isPhases = (s: { kind: string } | null | undefined): s is Phases => s?.kind === 'phases';

/** Days a phase runs, or null when it has no end. */
export const phaseDays = (p: Pick<Phase, 'length' | 'unit'>): number | null =>
	p.length === null ? null : Math.max(1, Math.floor(p.length)) * (p.unit === 'week' ? 7 : 1);

/** A schedule moved to begin on `from`: its own start, when it has one, becomes that day. */
const rebase = (s: Plain, from: ISODate): Plain => ('start' in s ? { ...s, start: from } : s);

/** Every phase that comes, with its days, oldest first. */
export function phaseSpans(s: Phases): PhaseSpan[] {
	const out: PhaseSpan[] = [];
	let from = s.start;
	for (const [index, p] of s.phases.entries()) {
		const n = phaseDays(p);
		const to = n === null ? null : addDays(from, n - 1);
		out.push({ index, from, to, schedule: rebase(p.schedule, from) });
		if (to === null) break;
		from = addDays(to, 1);
	}
	return out;
}

/** The phase a date falls in, or null before the first and after the last one ends. */
export function phaseOn(s: Phases, date: ISODate): PhaseSpan | null {
	if (date < s.start) return null;
	return phaseSpans(s).find((p) => date >= p.from && (p.to === null || date <= p.to)) ?? null;
}

/** The phases with each inner schedule's start set to its phase's first day, as saved. */
export function tidyPhases<S extends Phases>(s: S): S {
	const spans = phaseSpans(s);
	return { ...s, phases: s.phases.map((p, i) => ({ ...p, schedule: spans[i]?.schedule ?? p.schedule })) };
}

/**
 * The schedule with days of its own that is in force on a date: the phase's, for phases
 * (nothing due outside them), else the schedule itself.
 */
export function planOn<S extends Schedule>(s: S, date: ISODate): Exclude<S, Phases> | Plain {
	if (!isPhases(s)) return s as Exclude<S, Phases>;
	return phaseOn(s, date)?.schedule ?? NOTHING_DUE;
}

/** Only what was done in the phase a date falls in counts toward that phase's plan. */
export function historyOn(s: Schedule, history: Done[], date: ISODate): Done[] {
	if (!isPhases(s)) return history;
	const p = phaseOn(s, date);
	return p ? history.filter((h) => h.date >= p.from) : [];
}

/** The Variants a schedule can have due: for phases, those of every phase. */
export function variantsIn(s: Schedule | null | undefined): string[] {
	if (!s) return [];
	switch (s.kind) {
		case 'weekly':
			return [...new Set(Object.values(s.days).filter((v): v is string => !!v))];
		case 'frequency':
		case 'interval':
			return [s.variantId];
		case 'follow':
			// Only on these of the routine's Variants: what each maps to. Every day: any of them, or the rest.
			return [...new Set(s.on ? s.on.map((p) => followVariant(s, p)) : [s.variantId, ...Object.values(s.map ?? {})])];
		case 'rotation':
			return [...new Set(s.order.map((o) => o.variantId))];
		case 'phases':
			return [...new Set(s.phases.flatMap((p) => variantsIn(p.schedule)))];
		case 'group':
			return [];
	}
}

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
 * only when the routine's Variant is one of `on`. Which of its own Variants it logs comes from
 * the routine's Variant that day: `map` pairs a routine Variant with one of the habit's, and
 * any other day (or a day with no Variant known) logs `variantId`. So the two go through their
 * Variants in step: "Upper A" in the routine is always "Heavy" here, whatever the routine's
 * own rotation does. `on` decides when, `map` decides which. A routine inside a routine follows
 * it too, with its own rule for the habits inside it.
 */
export interface Follow extends Routine {
	kind: 'follow';
	variantId: string;
	on: string[] | null;
	/** Routine Variant id -> this habit's Variant id. Absent or empty: always `variantId`. */
	map?: Record<string, string>;
}

export const isGroup = (s: { kind: string } | null | undefined): s is GroupRule => s?.kind === 'group';
export const isFollow = (s: { kind: string } | null | undefined): s is Follow => s?.kind === 'follow';

/** The Variant a habit that follows its routine logs on a day the routine has `routineVariant` due ('' = not known). */
export const followVariant = (f: Pick<Follow, 'variantId' | 'map'>, routineVariant: string): string =>
	(routineVariant && f.map?.[routineVariant]) || f.variantId;

/** The rule a habit with habits inside it judges its day by. */
export function rollupRuleOf(s: Schedule | null | undefined): RollupRule {
	if (!s) return { target: null, minimum: null };
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
			return !schedule.on || schedule.on.includes(p) ? followVariant(schedule, p) : null;
		}

		case 'phases': {
			const p = phaseOn(schedule, date);
			return p ? dueOn(p.schedule, history.filter((h) => h.date >= p.from), date) : null;
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
