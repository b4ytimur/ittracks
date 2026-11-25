// log_plan: what Today and the log screen change about a day without logging it, by habit name.
// A prep step ticked for tomorrow, a resting rotation started early, a Slot's Task swapped or picked
// again for one day. The work itself is server/day-plan.ts, which the app's screens call too.
import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { slot, task, variant } from '../db/schema';
import { ensurePicks, ensureToday, nextEarly, pausesOf } from '../today';
import { rerollSlot, startEarly, swapSlot, tickPrep } from '../day-plan';
import { pauseOn } from '$lib/engine/pause';
import { ActionError, requireScope, type Actor } from './actor';
import { buildDay, dayOf, findHabit, occurrenceFor } from './day';
import { resultOf } from './log';

export interface PlanInput {
	habit: string;
	do: 'prep' | 'early' | 'swap' | 'reroll';
	item?: string;
	done?: boolean;
	slot?: string;
	task?: string;
	date?: string | null;
}

const low = (s: string) => s.trim().toLowerCase();
const taskName = (id: string | null | undefined) => (id ? (db.select({ name: task.name }).from(task).where(eq(task.id, id)).get()?.name ?? null) : null);

export function logPlan(actor: Actor, input: PlanInput) {
	requireScope(actor, 'log');
	switch (input.do) {
		case 'prep':
			return prep(actor, input);
		case 'early':
			return early(actor, input);
		default:
			return pick(actor, input);
	}
}

/** Tick (done: false unticks) a step of tomorrow's prep list. */
function prep(actor: Actor, input: PlanInput) {
	const h = findHabit(actor, input.habit);
	if (!h.prep?.length) throw new ActionError('invalid', `${h.name} has no prep list.`);
	if (!input.item) throw new ActionError('invalid', `Say which step: ${h.prep.join(', ')}.`);
	const item = h.prep.find((x) => x === input.item) ?? h.prep.find((x) => low(x) === low(input.item!));
	if (!item) throw new ActionError('not_found', `${h.name} has no prep step “${input.item}”. Its steps: ${h.prep.join(', ')}.`);
	const date = tickPrep(actor, h, item, input.done ?? true, dayOf(actor).today);
	return { habit: h.name, date, item, done: input.done ?? true };
}

/** Start a resting rotation's next Variant today. */
function early(actor: Actor, input: PlanInput) {
	const day = buildDay(actor, input.habit);
	if (day.date !== day.today) throw new ActionError('invalid', 'Only today can start early.');
	const { habit: h, schedule, today } = day;
	if (ensureToday(actor.accountId, h.id, schedule, today)) throw new ActionError('invalid', `${h.name} already has today's log: log it as usual.`);
	if (pauseOn(pausesOf(actor.accountId), h.id, today)) throw new ActionError('not_due', `${h.name} is paused today.`);
	const next = nextEarly(h.id, schedule, today);
	if (!next) throw new ActionError('invalid', `${h.name} isn't a rotation resting today, so there is nothing to start early. To log it anyway, use log_done with extra: true.`);
	const occ = startEarly(actor, h.id, next, today);
	const v = db.select({ name: variant.name }).from(variant).where(eq(variant.id, next)).get();
	return { ...resultOf(occ.id), variant: v?.name ?? null };
}

/** Swap a Slot's Task, or pick another one by its rule, for that day only. */
function pick(actor: Actor, input: PlanInput) {
	const day = buildDay(actor, input.habit, input.date);
	const occ = occurrenceFor(actor, day);
	if (!occ.variantId) throw new ActionError('invalid', `${day.habit.name} has no Tasks to change.`);
	const picks = ensurePicks(occ.id) ?? {};
	const slots = db.select().from(slot).where(eq(slot.variantId, occ.variantId)).orderBy(asc(slot.sortOrder)).all();
	const named = slots.map((s, i) => ({ s, n: i + 1, task: taskName(picks[s.id] ?? s.taskId) }));
	const list = () => named.map((x) => `${x.n}. ${x.task ?? '(nothing picked)'}${x.s.fillRule ? ' (picked by a rule)' : ''}`).join('; ');
	if (!input.slot) throw new ActionError('invalid', `Say which slot, by the Task in it now or its number: ${list()}.`);
	const r = input.slot.trim();
	const hit = named.find((x) => x.s.id === r) ?? named.find((x) => String(x.n) === r) ?? named.find((x) => x.task && low(x.task) === low(r));
	if (!hit) throw new ActionError('not_found', `No slot “${r}” on ${day.date}. The slots: ${list()}.`);
	let taskId: string;
	if (input.do === 'swap') {
		if (!input.task) throw new ActionError('invalid', 'Say which Task to use instead (its name or id).');
		const t = findTask(actor, input.task);
		swapSlot(actor, occ, hit.s.id, t);
		taskId = t;
	} else taskId = rerollSlot(actor, occ, hit.s.id);
	return { habit: day.habit.name, date: day.date, occurrenceId: occ.id, slot: hit.n, was: hit.task, now: taskName(taskId) };
}

/** A top-level Library Task by id, or by name (any case) among those not archived. */
function findTask(actor: Actor, ref: string): string {
	const all = db.select({ id: task.id, name: task.name, archived: task.archived, parent: task.parentTaskId }).from(task).where(eq(task.accountId, actor.accountId)).all().filter((t) => !t.parent);
	const byId = all.find((t) => t.id === ref);
	if (byId) return byId.id;
	const named = all.filter((t) => low(t.name) === low(ref));
	const active = named.filter((t) => !t.archived);
	if (active.length === 1) return active[0].id;
	if (active.length > 1) throw new ActionError('conflict', `More than one Task is called “${ref}”. Use its id.`, { ids: active.map((t) => t.id) });
	throw new ActionError('not_found', `No Task called “${ref}” in the Library.`);
}
