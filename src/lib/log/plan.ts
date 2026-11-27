// Change the plan, on a log: the plan's numbers and order, changed where they stand.
import type { HabitForm } from '$lib/forms';
import type { RowState } from './run';

export type Plan = HabitForm['variants'];
type Slot = Plan[number]['slots'][number];

export const slotIn = (plan: Plan, id: string): Slot | undefined => plan.flatMap((v) => v.slots).find((s) => s.id === id);

/** The plan with these Slots in this order; any other keeps its place. */
export const inOrder = (plan: Plan, order: string[]): Plan =>
	plan.map((v) => {
		const mine = order.flatMap((id) => v.slots.filter((s) => s.id === id));
		let i = 0;
		return { ...v, slots: v.slots.map((s) => (order.includes(s.id) ? mine[i++] : s)) };
	});

export const withSlot = (plan: Plan, id: string, set: Partial<Slot>): Plan => plan.map((v) => ({ ...v, slots: v.slots.map((s) => (s.id === id ? { ...s, ...set } : s)) }));

export const withoutSlot = (plan: Plan, id: string): Plan => plan.map((v) => ({ ...v, slots: v.slots.filter((s) => s.id !== id) }));
/** A Task at the end of one Variant. */
export const withTask = (plan: Plan, variant: string, id: string, taskId: string): Plan =>
	plan.map((v) => (v.id === variant ? { ...v, slots: [...v.slots, { id, taskId, fillRule: null, sets: null, targets: {}, minTargets: {}, stretchTargets: {} }] } : v));

/** The number in "4 sets" or "62,5 kg"; null when there is none. */
export function numberIn(text: string): number | null {
	const m = /\d+(?:[.,]\d+)?/.exec(text);
	return m ? Number(m[0].replace(',', '.')) : null;
}

/** A log's rows brought to a new count: only rows that aren't done come or go, from the end. */
export function toCount(rows: RowState[], n: number): RowState[] {
	const out = [...rows];
	while (out.length > n && !out[out.length - 1].done) out.pop();
	while (out.length < n) out.push({ done: false, values: { ...(out.at(-1)?.values ?? {}) } });
	return out;
}
