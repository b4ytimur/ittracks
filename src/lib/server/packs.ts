// Copying a starter pack into an account, taking it out again, and the exact Undo of both.
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { drop, packById, packState, take, type PackState } from '$lib/packs';
import { cardsUsing } from '$lib/stats/model';
import { unitTable } from '$lib/units';
import { db } from './db';
import { metric, tag, task, taskTag } from './db/schema';
import { getGroupings, getGroups, getKinds, getPacks, getSettings, getTaskTypes, saveSettings } from './settings';
import { getStats, saveStats } from './stats';
import { PLAIN_TASK_TYPES } from '$lib/task-types';

export const packTags = z.array(z.object({ id: z.string(), name: z.string(), grouping: z.string().nullable() })).max(200);
export const packUndo = z.object({ before: packState, after: packState, made: packTags, gone: packTags });
export type PackUndo = z.infer<typeof packUndo>;

const stateOf = (accountId: string): PackState => ({
	packs: getPacks(accountId),
	units: getKinds(accountId),
	groupings: getGroupings(accountId),
	measures: getStats(accountId).measures,
	taskTypes: getTaskTypes(accountId).filter((t) => !PLAIN_TASK_TYPES.some((p) => p.key === t.key))
});
/** The account's units as they are once a pack is in. */
export function unitsWith(accountId: string, id: string) {
	const p = packById(id);
	return unitTable(p ? take(stateOf(accountId), p).units : getKinds(accountId));
}
function write(accountId: string, s: PackState) {
	// Stats first: it says that the built-in measures are among them now.
	saveStats(accountId, { ...getStats(accountId), measures: s.measures });
	saveSettings(accountId, { packs: s.packs, units: s.units, groupings: s.groupings, taskTypes: s.taskTypes });
}
const ordered = (v: unknown): string => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const tagsOf = (accountId: string) => db.select({ id: tag.id, name: tag.name, grouping: tag.grouping }).from(tag).where(eq(tag.accountId, accountId)).all();
const usedTags = (ids: string[]) => new Set(ids.length ? db.select({ id: taskTag.tagId }).from(taskTag).where(inArray(taskTag.tagId, ids)).all().map((x) => x.id) : []);

export type PackResult = { undo: PackUndo; kept: string[] } | { error: string };

export function takePack(accountId: string, id: string): PackResult {
	const p = packById(id);
	if (!p) return { error: 'No such pack' };
	const before = stateOf(accountId);
	const after = take(before, p);
	const problem = packState.safeParse(after);
	if (!problem.success) return { error: 'There is no room for this pack. Delete some units, groupings or measures first.' };
	return db.transaction(() => {
		write(accountId, after);
		const have = new Set(tagsOf(accountId).map((t) => t.name.toLowerCase()));
		const made = p.groupings.flatMap((g) => {
			const own = after.groupings.find((x) => x.name.trim().toLowerCase() === g.name.toLowerCase())!;
			return g.members.filter((n) => !have.has(n.toLowerCase())).map((name) => ({ id: randomUUID(), name, grouping: own.id }));
		});
		for (const t of made) db.insert(tag).values({ ...t, accountId }).run();
		return { undo: { before, after: stateOf(accountId), made, gone: [] }, kept: [] };
	});
}

export function dropPack(accountId: string, id: string): PackResult {
	const p = packById(id);
	if (!p) return { error: 'No such pack' };
	const before = stateOf(accountId);
	const stats = getStats(accountId);
	const groups = getGroups(accountId);
	const tags = tagsOf(accountId);
	const used = usedTags(tags.map((t) => t.id));
	const units = db
		.select({ unit: metric.unit })
		.from(metric)
		.innerJoin(task, eq(metric.taskId, task.id))
		.where(and(eq(task.accountId, accountId), isNotNull(metric.unit)))
		.all()
		.map((m) => m.unit!);
	const { state, kept } = drop(before, p, {
		units,
		cards: (m) => cardsUsing(stats, { id: m }),
		tasks: (g) => tags.filter((t) => used.has(t.id) && groups.of(t.name).id === g).length
	});
	return db.transaction(() => {
		write(accountId, state);
		const left = new Set(state.groupings.map((g) => g.id));
		// Members nobody has go with their grouping.
		const gone = tags.filter((t) => t.grouping && !left.has(t.grouping) && !used.has(t.id));
		if (gone.length) db.delete(tag).where(inArray(tag.id, gone.map((t) => t.id))).run();
		return { undo: { before, after: stateOf(accountId), made: [], gone }, kept };
	});
}

/** Put back exactly what was there; not when something of it was changed since. */
export function undoPack(accountId: string, u: PackUndo): string {
	if (ordered(stateOf(accountId)) !== ordered(u.after)) return 'Your units, groupings, measures or Task types changed since, so they are left as they are.';
	db.transaction(() => {
		write(accountId, u.before);
		const made = u.made.map((t) => t.id);
		const used = usedTags(made);
		if (made.length) db.delete(tag).where(and(eq(tag.accountId, accountId), inArray(tag.id, made.filter((id) => !used.has(id))))).run();
		const have = new Set(tagsOf(accountId).map((t) => t.name.toLowerCase()));
		for (const t of u.gone) if (!have.has(t.name.toLowerCase())) db.insert(tag).values({ id: randomUUID(), accountId, name: t.name, grouping: t.grouping }).run();
	});
	// Packs an account had before they were stored stay that way only until the first change.
	return '';
}
