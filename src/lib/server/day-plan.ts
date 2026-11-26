// Changing what a day holds without logging it: ticking a prep step for tomorrow, starting a resting
// rotation's next Variant early, swapping or picking again a Slot's Task for one day, and answering
// Today's "raise the targets?" with Raise or Not yet. Today, the log screen and the AI tools
// (core/plan.ts, and setup's progression change) all call these, so each works the same everywhere.
import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { habit, occurrence, prepTick, slot, task, variant, type SlotGoals } from './db/schema';
import { candidates, createOccurrence, ensurePicks } from './today';
import { getGroups } from './settings';
import { keepGoals, stepsOf } from './progress';
import { raise, type Progression } from '$lib/engine/progression';
import { addDays } from '$lib/engine/dates';
import { pickTask, type FillRule } from '$lib/engine/fill';
import { ActionError, type Actor } from './core/actor';
import { emit } from './core/events';

type OccLike = { id: string; habitId: string; date: string; variantId: string | null; goals: Record<string, SlotGoals> | null };

/** Tick (or untick) a prep step for tomorrow. Returns tomorrow's date. */
export function tickPrep(actor: Actor, h: { id: string; prep: string[] | null }, item: string, done: boolean, today: string): string {
	if (!h.prep?.includes(item)) throw new ActionError('not_found', 'No such prep step');
	const date = addDays(today, 1);
	if (done) db.insert(prepTick).values({ habitId: h.id, date, item }).onConflictDoNothing().run();
	else db.delete(prepTick).where(and(eq(prepTick.habitId, h.id), eq(prepTick.date, date), eq(prepTick.item, item))).run();
	emit(actor, 'plan.changed', { habitId: h.id, date, data: { what: 'prep', item, done } });
	return date;
}

/** Start a rotation's next Variant today, ahead of its rest days. A day that already has its log keeps it. */
export function startEarly(actor: Actor, habitId: string, variantId: string, today: string) {
	const v = db
		.select({ id: variant.id })
		.from(variant)
		.where(and(eq(variant.id, variantId), eq(variant.habitId, habitId), eq(variant.archived, false)))
		.get();
	if (!v) throw new ActionError('not_found', 'No such Variant');
	const had = db.select().from(occurrence).where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, today))).get();
	if (had) return had;
	const occ = createOccurrence(actor.accountId, habitId, v.id, today);
	emit(actor, 'plan.changed', { habitId, date: today, data: { what: 'early', occurrenceId: occ.id, variantId: v.id } });
	return occ;
}

/** A Slot of the day's Variant. */
function slotOf(occ: OccLike, slotId: string) {
	const s = occ.variantId ? db.select().from(slot).where(and(eq(slot.id, slotId), eq(slot.variantId, occ.variantId))).get() : undefined;
	if (!s) throw new ActionError('not_found', 'No such Slot');
	return s;
}

/**
 * The Task a Slot has in a day's plan, without that day's swap: the one kept with the log when the
 * plan changed since (see keepGoals), else the Slot's own. Null for an auto-filled Slot.
 */
export const ownTask = (occ: Pick<OccLike, 'goals'>, slotId: string, s: { taskId: string | null } | undefined) => (occ.goals?.[slotId] ?? s)?.taskId ?? null;

/** Use a Task in a Slot for this day. Back to the Slot's own Task there is no pick, so a later change to the plan reaches it. */
function setPick(actor: Actor, occ: OccLike, s: typeof slot.$inferSelect, taskId: string, what: 'swap' | 'reroll') {
	const { [s.id]: _, ...rest } = ensurePicks(occ.id) ?? {};
	const picks = taskId === ownTask(occ, s.id, s) ? rest : { ...rest, [s.id]: taskId };
	db.update(occurrence).set({ picks }).where(eq(occurrence.id, occ.id)).run();
	emit(actor, 'plan.changed', { habitId: occ.habitId, date: occ.date, data: { what, occurrenceId: occ.id, slotId: s.id, taskId } });
}

/** Pick a different Task for an auto-filled Slot, for this day only. Returns the Task picked. */
export function rerollSlot(actor: Actor, occ: OccLike, slotId: string): string {
	const s = slotOf(occ, slotId);
	if (!s.fillRule) throw new ActionError('invalid', 'That Slot has its own Task: swap it instead.');
	// Every Task already in the day is left out, the current pick too.
	const fixed = db
		.select({ taskId: slot.taskId })
		.from(slot)
		.where(eq(slot.variantId, s.variantId))
		.all()
		.flatMap((x) => (x.taskId ? [x.taskId] : []));
	const used = new Set([...Object.values(ensurePicks(occ.id) ?? {}), ...fixed]);
	const next = pickTask(s.fillRule as FillRule, candidates(actor.accountId), getGroups(actor.accountId).rank, used);
	if (!next) throw new ActionError('invalid', 'No other Task matches this slot.');
	setPick(actor, occ, s, next, 'reroll');
	return next;
}

/** Use a Task of your choice in a Slot, for this day only. */
export function swapSlot(actor: Actor, occ: OccLike, slotId: string, taskId: string) {
	const s = slotOf(occ, slotId);
	const t = db
		.select({ id: task.id })
		.from(task)
		.where(and(eq(task.id, taskId), eq(task.accountId, actor.accountId), isNull(task.parentTaskId)))
		.get();
	if (!t) throw new ActionError('not_found', 'No such Task');
	setPick(actor, occ, s, t.id, 'swap');
}

/** Raise: Target and Stretch go up in every Slot by the habit's progression; logs before keep what they aimed for. */
export function raiseTargets(actor: Actor, h: { id: string; progression: Progression | null }, today: string) {
	const p = h.progression;
	if (!p) throw new ActionError('invalid', 'That habit has no progression.');
	db.transaction((tx) => {
		const variants = tx.select({ id: variant.id }).from(variant).where(and(eq(variant.habitId, h.id), eq(variant.archived, false))).all();
		keepGoals(tx, variants.map((v) => v.id));
		for (const v of variants)
			for (const s of tx.select().from(slot).where(eq(slot.variantId, v.id)).all()) {
				// By steps, each target rises by its own field's step: 2.5 kg, 1 rep.
				const steps = stepsOf([...Object.keys(s.targets ?? {}), ...Object.keys(s.stretchTargets ?? {})], tx);
				tx.update(slot)
					.set({
						targets: s.targets ? raise(s.targets, p, steps) : s.targets,
						stretchTargets: s.stretchTargets ? raise(s.stretchTargets, p, steps) : s.stretchTargets
					})
					.where(eq(slot.id, s.id))
					.run();
			}
		tx.update(habit).set({ progressionFrom: today }).where(eq(habit.id, h.id)).run();
	});
	emit(actor, 'plan.changed', { habitId: h.id, date: today, data: { what: 'raise' } });
}

/** Not yet: the targets stay, and the count toward the next suggestion starts again from today. */
export function notYet(actor: Actor, habitId: string, today: string) {
	db.update(habit).set({ progressionFrom: today }).where(eq(habit.id, habitId)).run();
	emit(actor, 'plan.changed', { habitId, date: today, data: { what: 'not_yet' } });
}
