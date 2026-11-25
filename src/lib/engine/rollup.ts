// A group's day, worked out from the days of the habits inside it. Pure: the server stores the
// result as the group's Occurrence (see server/rollup.ts), and Today uses it to count live.
import type { RollupRule } from './schedule';
import type { Level, OccurrenceStatus } from './streak';

/** One habit's Occurrence on the day, as the group or routine sees it. */
export interface ChildDay {
	status: OccurrenceStatus;
	/** Null or absent means Target. */
	level?: Level | null;
	/** Logged on a day it wasn't due: doesn't count for the group. */
	extra?: boolean;
}

export interface GroupDay {
	status: OccurrenceStatus;
	/** Null means Target, as on any Occurrence. */
	level: Level | null;
	/** Habits inside that were done, of the ones that counted. */
	done: number;
	total: number;
}

/**
 * The day of a group or routine, or null when nothing inside it was due. A skipped habit
 * counts neither way, and a day whose habits were all skipped is skipped. Enough done (all of
 * them, or the rule's target) makes the day done, at Stretch when every habit that counted was
 * done at Stretch. Otherwise the day stays due while a habit inside is still due today; once
 * nothing is left to do, or the day is over, it is done at the Minimum when it reached that,
 * and missed when it is over and fell short.
 */
export function rollupDay(children: ChildDay[], rule: RollupRule, opts: { past: boolean }): GroupDay | null {
	const planned = children.filter((c) => !c.extra);
	// A past day still marked due was never judged (a habit that ignores unlogged days): it doesn't count.
	const counted = planned.filter((c) => c.status !== 'skipped' && !(opts.past && c.status === 'due'));
	const done = counted.filter((c) => c.status === 'done').length;
	const total = counted.length;
	if (total === 0)
		return planned.some((c) => c.status === 'skipped') ? { status: 'skipped', level: null, done: 0, total: 0 } : null;
	const need = Math.min(rule.target ?? total, total);
	if (done >= need) {
		const stretch = done === total && counted.every((c) => c.level === 'stretch');
		return { status: 'done', level: stretch ? 'stretch' : null, done, total };
	}
	if (!opts.past && counted.some((c) => c.status === 'due')) return { status: 'due', level: null, done, total };
	const minimum = rule.minimum === null ? null : Math.min(rule.minimum, total);
	if (minimum !== null && done >= minimum) return { status: 'done', level: 'minimum', done, total };
	return { status: opts.past ? 'missed' : 'due', level: null, done, total };
}

/** "2 of 3 habits". */
export const rollupText = (r: { done: number; total: number }) => `${r.done} of ${r.total} habit${r.total === 1 ? '' : 's'}`;

/** A habit a routine's Done left open: `at` is its time still ahead today, null when it needs values first. */
export interface LeftOpen {
	habit: string;
	at: string | null;
}

const names = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "Evening Lisinopril waits for 20:00. Blood pressure needs values filled in before it counts." */
export function leftText(left: LeftOpen[]): string {
	const waiting = left.filter((l) => l.at).map((l) => `${l.habit} waits for ${l.at}.`);
	const need = left.filter((l) => !l.at).map((l) => l.habit);
	if (need.length) waiting.push(`${names(need)} ${need.length > 1 ? 'need' : 'needs'} values filled in before ${need.length > 1 ? 'they count' : 'it counts'}.`);
	return waiting.join(' ');
}
