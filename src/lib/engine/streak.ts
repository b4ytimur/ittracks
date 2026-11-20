import { addDays, daysBetween, weekStart, type ISODate } from './dates';

export type OccurrenceStatus = 'due' | 'done' | 'skipped' | 'missed';
export type Level = 'minimum' | 'target' | 'stretch';

/** How a build habit's streak is counted. Chosen per Habit. */
export type StreakRule =
	| { kind: 'strict' }
	| { kind: 'neverTwice' }
	| { kind: 'grace'; misses: number; period: 'week' | 'month' }
	| { kind: 'consistency'; days: number };

/** New habits follow the book: missing once is an accident, missing twice starts a new habit. */
export const DEFAULT_STREAK_RULE: StreakRule = { kind: 'neverTwice' };

/** One Occurrence as the streak sees it. */
export interface Mark {
	date: ISODate;
	status: OccurrenceStatus;
	level?: Level | null;
}

export interface StreakResult {
	/** Occurrences in a row, or a percentage for the consistency rule. */
	value: number;
	unit: 'streak' | 'percent';
	/** Never miss twice: the last Occurrence was missed, so the next one decides. */
	atRisk: boolean;
}

/** Strict streak from bare statuses, oldest first. Kept for callers without dates. */
export function buildStreak(statuses: OccurrenceStatus[]): number {
	return streak(statuses.map((status) => ({ date: '', status })), { kind: 'strict' }).value;
}

/**
 * The streak under a rule, from Marks sorted oldest first. Due Occurrences are ignored.
 * `minimumCounts` decides whether a done at the Minimum level keeps the streak alive;
 * when it doesn't, that Occurrence counts as a miss.
 */
export function streak(
	marks: Mark[],
	rule: StreakRule,
	opts: { minimumCounts?: boolean; today?: ISODate } = {}
): StreakResult {
	const minimumCounts = opts.minimumCounts ?? true;
	const acted = marks
		.filter((m) => m.status !== 'due')
		.map((m) =>
			m.status === 'done' && m.level === 'minimum' && !minimumCounts
				? { ...m, status: 'missed' as const }
				: m
		);
	const atRisk = rule.kind === 'neverTwice' && acted.at(-1)?.status === 'missed';

	switch (rule.kind) {
		case 'strict': {
			let n = 0;
			for (let i = acted.length - 1; i >= 0 && acted[i].status !== 'missed'; i--) n++;
			return { value: n, unit: 'streak', atRisk };
		}

		case 'neverTwice': {
			// A single miss is forgiven and adds nothing; two in a row end the streak.
			let n = 0;
			let newerMissed = false;
			for (let i = acted.length - 1; i >= 0; i--) {
				if (acted[i].status === 'missed') {
					if (newerMissed) break;
					newerMissed = true;
				} else {
					n++;
					newerMissed = false;
				}
			}
			return { value: n, unit: 'streak', atRisk };
		}

		case 'grace': {
			// Up to N misses per week or month are allowed; one more ends the streak.
			const bucket = (d: ISODate) => (rule.period === 'week' ? weekStart(d) : d.slice(0, 7));
			const missesIn = new Map<string, number>();
			let n = 0;
			for (let i = acted.length - 1; i >= 0; i--) {
				const m = acted[i];
				if (m.status === 'missed') {
					const b = bucket(m.date);
					const count = (missesIn.get(b) ?? 0) + 1;
					if (count > rule.misses) break;
					missesIn.set(b, count);
				} else n++;
			}
			return { value: n, unit: 'streak', atRisk };
		}

		case 'consistency': {
			// Share of the last N days' Occurrences that were done; skipped ones count neither way.
			const today = opts.today ?? acted.at(-1)?.date ?? '';
			const from = today ? addDays(today, -(rule.days - 1)) : '';
			const window = acted.filter((m) => m.date >= from && m.date <= today && m.status !== 'skipped');
			const done = window.filter((m) => m.status === 'done').length;
			return {
				value: window.length ? Math.round((done / window.length) * 100) : 0,
				unit: 'percent',
				atRisk
			};
		}
	}
}

/** A short label for a streak, or '' when there is nothing worth showing. */
export function describeStreak(r: StreakResult, rule: StreakRule): string {
	if (r.unit === 'percent') return `${r.value}% over ${rule.kind === 'consistency' ? rule.days : 30} days`;
	return r.value > 0 ? `streak ${r.value}` : '';
}

/** Break habit: whole days since the last Slip, or since the start if none. */
export function daysSinceSlip(slipDates: ISODate[], start: ISODate, today: ISODate): number {
	const last = [...slipDates].filter((d) => d <= today).sort().at(-1);
	return daysBetween(last ?? start, today);
}

/** Break habit: the longest run of slip-free days between start and today. */
export function longestRun(slipDates: ISODate[], start: ISODate, today: ISODate): number {
	const points = [start, ...[...new Set(slipDates)].filter((d) => d <= today).sort(), today];
	let best = 0;
	for (let i = 1; i < points.length; i++) {
		// The counter reads its highest on the day of the next slip, before it resets, or today.
		best = Math.max(best, daysBetween(points[i - 1], points[i]));
	}
	return best;
}
