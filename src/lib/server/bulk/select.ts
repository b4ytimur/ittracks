// A selection as data, turned into the rows it means: habits or Tasks by id (or name), or every
// one that matches a filter; days by log id or habit@date. The same for 1 item or all of them,
// from the app or a key.
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { habit, occurrence, tag, task, taskTag } from '../db/schema';
import { listAreas } from '../repo/areas';
import { ActionError, type Actor } from '../core/actor';
import { findHabit, visibleHabits, type HabitRow } from '../core/day';
import { isRealDate } from '$lib/engine/backfill';
import type { BulkInput, TargetKind } from '$lib/bulk/catalog';

export type TaskRow = typeof task.$inferSelect;
/** One habit's day. `id` is the reference it was picked by, so the report names it back. */
export interface DayRow {
	id: string;
	habit: HabitRow;
	date: string;
}
export type Selected = { kind: 'habit'; rows: HabitRow[] } | { kind: 'task'; rows: TaskRow[] } | { kind: 'day'; rows: DayRow[] };

type Selection = Pick<BulkInput, 'ids' | 'filter'>;

/** An Area by id or name (any case). */
export function areaOf(accountId: string, ref: string): string {
	const areas = listAreas(accountId);
	const a = areas.find((x) => x.id === ref) ?? areas.find((x) => x.name.trim().toLowerCase() === ref.trim().toLowerCase());
	if (!a) throw new ActionError('invalid', `No Area called “${ref}”. Pick one of: ${areas.map((x) => x.name).join(', ')}.`);
	return a.id;
}

export function select(actor: Actor, kind: TargetKind, sel: Selection): Selected {
	if (!sel.ids && !sel.filter) throw new ActionError('invalid', 'Say which items to change: ids, or a filter ({} for all).');
	if (sel.ids && sel.filter) throw new ActionError('invalid', 'Send ids or a filter, not both.');
	if (kind === 'habit') return { kind, rows: habits(actor, sel) };
	if (kind === 'task') return { kind, rows: tasks(actor, sel) };
	return { kind, rows: days(actor, sel) };
}

/**
 * Days by a log id (History's rows, the read tools' ids) or "habit@YYYY-MM-DD" for a day with no
 * log yet. Oldest first within each habit, since skipping one day can change what a rotation has
 * due the next. A range of days is skip_days on the habits, so days take no filter.
 */
function days(actor: Actor, sel: Selection): DayRow[] {
	if (!sel.ids) throw new ActionError('invalid', 'Pick days by id. For every day in a date range, use skip_days on the habits instead.');
	const seen = new Set<string>();
	const out: DayRow[] = [];
	for (const ref of sel.ids) {
		const occ = db
			.select({ habitId: occurrence.habitId, date: occurrence.date })
			.from(occurrence)
			.innerJoin(habit, eq(occurrence.habitId, habit.id))
			.where(and(eq(occurrence.id, ref), eq(habit.accountId, actor.accountId)))
			.get();
		const at = occ ? null : /^(.+)@(\d{4}-\d{2}-\d{2})$/.exec(ref);
		if (!occ && !at) throw new ActionError('not_found', `No day “${ref}”. Use a log id, or the habit and the date as “Drink water@2026-11-16”.`);
		if (at && !isRealDate(at[2])) throw new ActionError('invalid', `“${at[2]}” is not a date. Use YYYY-MM-DD.`);
		// findHabit applies a key's habit limits, for log ids too.
		const h = findHabit(actor, occ ? occ.habitId : at![1]);
		const date = occ ? occ.date : at![2];
		if (seen.has(`${h.id}@${date}`)) continue;
		seen.add(`${h.id}@${date}`);
		out.push({ id: ref, habit: h, date });
	}
	const order = new Map<string, number>();
	for (const d of out) if (!order.has(d.habit.id)) order.set(d.habit.id, order.size);
	return out.sort((a, b) => order.get(a.habit.id)! - order.get(b.habit.id)! || a.date.localeCompare(b.date));
}

function habits(actor: Actor, sel: Selection): HabitRow[] {
	if (sel.ids) {
		const seen = new Set<string>();
		return sel.ids.map((ref) => findHabit(actor, ref)).filter((h) => !seen.has(h.id) && !!seen.add(h.id));
	}
	const f = sel.filter!;
	const area = f.area ? areaOf(actor.accountId, f.area) : null;
	return visibleHabits(actor, { archived: f.archived }).filter((h) => (!area || h.areaId === area) && (!f.direction || h.direction === f.direction));
}

/** Library Tasks only: a Task's own steps change with it. A key limited to some habits can't change Tasks others share. */
function tasks(actor: Actor, sel: Selection): TaskRow[] {
	if (actor.habitIds) throw new ActionError('forbidden', 'This key is limited to some habits, so it can’t change Tasks other habits may use.');
	const all = db
		.select()
		.from(task)
		.where(eq(task.accountId, actor.accountId))
		.all()
		.filter((t) => !t.parentTaskId);
	if (sel.ids) {
		const out = new Map<string, TaskRow>();
		for (const ref of sel.ids) {
			const byId = all.find((t) => t.id === ref);
			const named = byId ? [byId] : all.filter((t) => t.name.trim().toLowerCase() === ref.trim().toLowerCase());
			const live = named.filter((t) => !t.archived);
			const pick = named.length === 1 ? named[0] : live.length === 1 ? live[0] : null;
			if (!named.length) throw new ActionError('not_found', `No Task called “${ref}”.`);
			if (!pick) throw new ActionError('conflict', `More than one Task is called “${ref}”. Use its id.`, { ids: named.map((t) => t.id) });
			out.set(pick.id, pick);
		}
		return [...out.values()];
	}
	const f = sel.filter!;
	const area = f.area ? areaOf(actor.accountId, f.area) : null;
	const tagged = f.tag
		? new Set(
				db
					.select({ id: taskTag.taskId })
					.from(taskTag)
					.innerJoin(tag, eq(taskTag.tagId, tag.id))
					.where(and(eq(tag.accountId, actor.accountId), sql`lower(${tag.name}) = ${f.tag.trim().toLowerCase()}`))
					.all()
					.map((r) => r.id)
			)
		: null;
	return all
		.filter((t) => (f.archived || !t.archived) && (!area || t.areaId === area) && (!tagged || tagged.has(t.id)))
		.sort((a, b) => a.name.localeCompare(b.name));
}
