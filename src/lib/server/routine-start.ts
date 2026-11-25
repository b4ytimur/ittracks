// A rotating habit put into a routine starts the routine where the habit is now:
// Gym on Upper B that starts to follow a new "Gym day" rotation makes Gym day start at Upper B,
// not at its first Variant. Only a routine whose rotation hasn't begun is turned; the order keeps
// its sequence and rest days, so only where it starts changes.
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { habit, variant } from './db/schema';
import { history } from './today';
import { firstDue, historyOn, isFollow, isPhases, phaseOn, planOn, type Rotation, type Schedule } from '$lib/engine/schedule';
import { rotationStartingAt } from '$lib/engine/follow';

export interface RoutineTurn {
	routineId: string;
	/** The routine's schedule, turned. */
	schedule: Schedule;
	/** What it says: "Gym day starts at Upper B, where Gym is now." */
	said: string;
}

type Q = Pick<typeof db, 'select'>;

/**
 * The turn a save makes to the routine a habit starts to follow, or null: the habit had a rotation
 * of its own (it is on one of its Variants now), now follows `after.parentId` with a Variant map,
 * and that routine's rotation has no day acted on yet.
 */
export function routineTurnFor(accountId: string, habitId: string | null, after: { name: string; schedule: unknown; parentId: string | null }, today: string, q: Q = db): RoutineTurn | null {
	if (!habitId || !after.parentId || !isFollow(after.schedule as Schedule | null)) return null;
	const was = q.select({ schedule: habit.schedule }).from(habit).where(and(eq(habit.id, habitId), eq(habit.accountId, accountId))).get()?.schedule as Schedule | null;
	if (!was || isFollow(was)) return null;
	const own = planOn(was, today);
	if (own.kind !== 'rotation') return null;
	const at = firstDue(own, historyOn(was, history(habitId, today), today), today);
	const r = q.select({ id: habit.id, name: habit.name, schedule: habit.schedule }).from(habit).where(and(eq(habit.id, after.parentId), eq(habit.accountId, accountId))).get();
	const rs = r?.schedule as Schedule | null;
	if (!at || !r || !rs || isFollow(rs)) return null;
	// A routine that starts later is turned from its first day.
	const from = 'start' in rs && rs.start > today ? rs.start : today;
	const plan = planOn(rs, from);
	if (plan.kind !== 'rotation') return null;
	// A rotation under way has its place: the routine's days decide, not the habit's.
	if (historyOn(rs, history(r.id, from), from).some((h) => !h.extra)) return null;
	const turned = rotationStartingAt(plan, after.schedule as Extract<Schedule, { kind: 'follow' }>, at, from);
	if (!turned) return null;
	const first = firstDue(turned, [], from);
	const name = first ? q.select({ name: variant.name }).from(variant).where(eq(variant.id, first)).get()?.name : null;
	return { routineId: r.id, schedule: withPlan(rs, from, turned), said: `${r.name} starts at ${name ?? 'that Variant'}, where ${after.name} is now.` };
}

/** The schedule with the rotation in force on a date replaced: the phase's, for phases. */
function withPlan(s: Schedule, date: string, plan: Rotation): Schedule {
	// A plain rotation is the plan itself, its rule for the habits inside kept with it.
	if (!isPhases(s)) return plan as Schedule;
	const span = phaseOn(s, date);
	return span ? { ...s, phases: s.phases.map((p, i) => (i === span.index ? { ...p, schedule: plan } : p)) } : s;
}
