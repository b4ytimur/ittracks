// A selection as data, turned into the rows it means: habits or Tasks by id (or name), or every
// one that matches a filter. The same for 1 item or all of them, from the app or a key.
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { tag, task, taskTag } from '../db/schema';
import { listAreas } from '../repo/areas';
import { ActionError, type Actor } from '../core/actor';
import { findHabit, visibleHabits, type HabitRow } from '../core/day';
import type { BulkInput, TargetKind } from '$lib/bulk/catalog';

export type TaskRow = typeof task.$inferSelect;
export type Selected = { kind: 'habit'; rows: HabitRow[] } | { kind: 'task'; rows: TaskRow[] };

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
	return kind === 'habit' ? { kind, rows: habits(actor, sel) } : { kind, rows: tasks(actor, sel) };
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
