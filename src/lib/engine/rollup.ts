// A group's day, worked out from the days of the habits inside it. Pure: the server stores the
// result as the group's Occurrence (see server/rollup.ts), and Today uses it to count live.
import type { GroupRule } from './schedule';
import type { Level, OccurrenceStatus } from './streak';

/** One habit's Occurrence on the day, as the group sees it. */
export interface ChildDay {
	status: OccurrenceStatus;
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
 * The group's day, or null when nothing inside it was due. A skipped habit counts neither way,
 * and a group whose habits were all skipped is skipped. Enough done (all of them, or the
 * rule's target) makes the day done. Otherwise the day stays due while a habit inside is still
 * due today; once nothing is left to do, or the day is over, it is done at the Minimum when it
 * reached that, and missed when it is over and fell short.
 */
export function rollupDay(
	children: ChildDay[],
	rule: Pick<GroupRule, 'target' | 'minimum'>,
	opts: { past: boolean }
): GroupDay | null {
	const planned = children.filter((c) => !c.extra);
	// A past day still marked due was never judged (a habit that ignores unlogged days): it doesn't count.
	const counted = planned.filter((c) => c.status !== 'skipped' && !(opts.past && c.status === 'due'));
	const done = counted.filter((c) => c.status === 'done').length;
	const total = counted.length;
	if (total === 0)
		return planned.some((c) => c.status === 'skipped') ? { status: 'skipped', level: null, done: 0, total: 0 } : null;
	const need = Math.min(rule.target ?? total, total);
	if (done >= need) return { status: 'done', level: null, done, total };
	if (!opts.past && counted.some((c) => c.status === 'due')) return { status: 'due', level: null, done, total };
	const minimum = rule.minimum === null ? null : Math.min(rule.minimum, total);
	if (minimum !== null && done >= minimum) return { status: 'done', level: 'minimum', done, total };
	return { status: opts.past ? 'missed' : 'due', level: null, done, total };
}

/** "2 of 3 habits". */
export const rollupText = (r: { done: number; total: number }) => `${r.done} of ${r.total} habit${r.total === 1 ? '' : 's'}`;
