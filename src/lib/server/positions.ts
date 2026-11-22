// The places in a day's log (see engine/parts.ts), loaded from the database: each Slot's Task
// and the parts inside it, round by round. Shared by the log screen, progress, one-tap logs,
// "Same as last time" and the API, so they all agree on what a log holds.
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from './db';
import { metric, slot, taskPart, type SlotGoals } from './db/schema';
import { expand, partsOfPath, type PartRow, type Position } from '$lib/engine/parts';

type Q = Pick<typeof db, 'select'>;

export interface OccLike {
	id: string;
	variantId: string | null;
	picks: Record<string, string> | null;
	/** The targets the Slots had when they changed later; null when today's still apply. */
	goals?: Record<string, SlotGoals> | null;
}

/** Every part reachable from these Tasks, by the Task they are inside, in order. */
export function partsBelow(taskIds: string[], q: Q = db): Map<string, PartRow[]> {
	const out = new Map<string, PartRow[]>();
	let next = [...new Set(taskIds)];
	const seen = new Set<string>();
	while (next.length) {
		const ask = next.filter((t) => !seen.has(t));
		for (const t of ask) seen.add(t);
		if (!ask.length) break;
		const rows: PartRow[] = [];
		for (let i = 0; i < ask.length; i += 900)
			rows.push(...q.select().from(taskPart).where(inArray(taskPart.taskId, ask.slice(i, i + 900))).orderBy(asc(taskPart.sortOrder)).all());
		for (const r of rows) out.set(r.taskId, [...(out.get(r.taskId) ?? []), r]);
		next = rows.map((r) => r.childTaskId).filter((t) => !seen.has(t));
	}
	return out;
}

/** Tasks with a field logged per set: their sets are their own, not rounds of their parts. */
export function perSetTasks(taskIds: string[], q: Q = db): Set<string> {
	const out = new Set<string>();
	const ids = [...new Set(taskIds)];
	for (let i = 0; i < ids.length; i += 900)
		for (const m of q
			.select({ taskId: metric.taskId })
			.from(metric)
			.where(and(inArray(metric.taskId, ids.slice(i, i + 900)), eq(metric.repeats, true), eq(metric.archived, false)))
			.all())
			out.add(m.taskId);
	return out;
}

/**
 * The places in each Occurrence's log, by Occurrence id. A Slot aims for the targets kept
 * with the log (when they changed later), else its own; parts aim for their own. `keep`
 * names archived parts that still show in one log, because it has values under them.
 */
export function positionsFor(occs: OccLike[], opts: { keep?: (occId: string) => Set<string>; q?: Q } = {}): Map<string, Position[]> {
	const q = opts.q ?? db;
	const out = new Map<string, Position[]>();
	const variantIds = [...new Set(occs.map((o) => o.variantId).filter((v): v is string => !!v))];
	const slots = variantIds.length ? q.select().from(slot).where(inArray(slot.variantId, variantIds)).orderBy(asc(slot.sortOrder)).all() : [];
	const tops = new Map<string, string[]>();
	for (const o of occs) tops.set(o.id, slots.filter((s) => s.variantId === o.variantId).map((s) => o.picks?.[s.id] ?? s.taskId).filter((t): t is string => !!t));
	const topIds = [...new Set([...tops.values()].flat())];
	const parts = partsBelow(topIds, q);
	const perSet = perSetTasks([...topIds, ...[...parts.values()].flat().map((p) => p.childTaskId)], q);
	for (const o of occs) {
		const keep = opts.keep?.(o.id);
		out.set(
			o.id,
			expand(
				slots
					.filter((s) => s.variantId === o.variantId)
					.map((s) => {
						const g = o.goals?.[s.id];
						return {
							slotId: s.id,
							taskId: o.picks?.[s.id] ?? s.taskId,
							sets: g ? g.sets : s.sets,
							targets: g ? g.targets : s.targets,
							minTargets: g ? g.minTargets : s.minTargets,
							stretchTargets: g ? g.stretchTargets : s.stretchTargets
						};
					}),
				{ partsOf: (t) => parts.get(t) ?? [], perSet: (t) => perSet.has(t), keep: keep ? (id) => keep.has(id) : undefined }
			)
		);
	}
	return out;
}

/** The places in one Occurrence's log. */
export const positionsOf = (occ: OccLike, opts: { keep?: Set<string>; q?: Q } = {}): Position[] =>
	positionsFor([occ], { q: opts.q, keep: opts.keep ? () => opts.keep! : undefined }).get(occ.id) ?? [];

/** The part ids a log's Entries sit under: archived parts that still show in it. */
export const partIdsIn = (entries: { path?: string | null }[]): Set<string> => new Set(entries.flatMap((e) => (e.path ? partsOfPath(e.path) : [])));
