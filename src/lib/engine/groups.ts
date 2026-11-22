// A Variant can use the same Task in two Slots (reading in the morning and at night). Their
// Entries share the Task id, so each Slot's Entries are told apart by order: a Slot saves its
// sets first and its once-per-log values last, which close its group. A Yes or no Task has
// only its tick, which closes the group too, and a Slot with sets but no once-per-log values
// ends with an empty `{ _summary: true }` when the Task is used twice.

type Values = Record<string, unknown>;

/** A Yes or no tick: an Entry that only says it was done. */
export const isTick = (v: Values): boolean => v.done === true && Object.keys(v).length === 1;

/** The Entries of one Task, one group per Slot, in Slot order. */
export function slotGroups<E extends { taskId: string; values: Values }>(entries: E[], taskId: string): E[][] {
	const groups: E[][] = [];
	let cur: E[] = [];
	for (const e of entries) {
		if (e.taskId !== taskId) continue;
		cur.push(e);
		if (e.values._summary === true || isTick(e.values)) {
			groups.push(cur);
			cur = [];
		}
	}
	if (cur.length) groups.push(cur);
	return groups;
}
