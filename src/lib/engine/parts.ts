// Tasks inside Tasks. A Slot holds a Task, and a Task can hold parts: other Tasks (from the
// Library, or private steps), each with its own sets and targets. Pure, so the log screen,
// progress, quick logs, the API, Stats and the editor all walk the same tree.
//
// Every value logged sits at a path: the Slot id, then each part id from the top down. A Task
// with parts and no per-set fields repeats its parts once per set (rounds), and the round is
// part of the path: "slot#2/part" is that part in round 2. A path tells two places of the
// same Task apart, which order alone can't once one Task can sit at several depths.
import { childrenOf, descendants, type Node } from './tree';
import { slotGroups } from './groups';

/** How deep parts can go below a Slot: a Slot's Task is depth 0. */
export const MAX_DEPTH = 4;
/** A log never expands to more places than this, however many rounds are nested. */
export const MAX_POSITIONS = 400;

export interface Goals {
	targets: Record<string, number> | null;
	minTargets: Record<string, number> | null;
	stretchTargets: Record<string, number> | null;
}

/** A Task in a Task. */
export interface PartRow extends Goals {
	id: string;
	/** The Task this part is inside. */
	taskId: string;
	childTaskId: string;
	sets: number | null;
	sortOrder: number;
	archived: boolean;
}

/** The top of a tree: a Slot with the Task it uses that day. */
export interface Top extends Goals {
	slotId: string;
	taskId: string | null;
	sets: number | null;
}

/** One place in a log: a Slot's Task, or a part at some depth (once per round). */
export interface Position extends Goals {
	path: string;
	slotId: string;
	/** The part it comes from; null for the Slot's own Task. */
	partId: string | null;
	taskId: string;
	depth: number;
	/** The path of the Task it is inside; null at the top. */
	parent: string | null;
	/** Its round in a parent that repeats: 2 of 3. Null when the parent doesn't repeat. */
	round: { n: number; of: number } | null;
	/** Sets to log, or on a Task whose parts repeat, its rounds. */
	sets: number | null;
	/** How many parts it holds (each once per round). */
	kids: number;
	/** Its parts repeat once per set. */
	rounds: number;
}

/** The path of a part inside the Task at `parent`, in a round when the parent repeats. */
export const childPath = (parent: string, round: number | null, partId: string) => `${parent}${round ? `#${round}` : ''}/${partId}`;

/** A path's steps from the top, with the round each one repeats in. */
export function parsePath(path: string): { id: string; round: number | null }[] {
	return path.split('/').map((seg) => {
		const [id, r] = seg.split('#');
		return { id, round: r ? Number(r) : null };
	});
}

/** The Slot a path starts at. */
export const slotOfPath = (path: string) => path.split(/[#/]/)[0];
/** The part ids along a path, below the Slot. */
export const partsOfPath = (path: string) => parsePath(path).slice(1).map((s) => s.id);
/** The same place in every round: "slot#2/part" and "slot#1/part" are both "slot/part". */
export const withoutRounds = (path: string) => path.replace(/#\d+/g, '');
/** The path of the Task a path's place is inside, or null at the top. */
export function parentPath(path: string): string | null {
	const i = path.lastIndexOf('/');
	return i < 0 ? null : path.slice(0, i).replace(/#\d+$/, '');
}

/** A path as the log screen and the API accept it: ids, slashes and round numbers, nothing else. */
export const PATH_RE = /^[\w-]{1,64}(#\d{1,3})?(\/[\w-]{1,64}(#\d{1,3})?){0,8}$/;

export interface ExpandOptions {
	/** Parts of a Task, in order (archived ones included; see `keep`). */
	partsOf: (taskId: string) => PartRow[];
	/** Does the Task have fields logged per set? Then its sets are its own, not rounds. */
	perSet: (taskId: string) => boolean;
	/** An archived part still shows when this says so: the log has values under it. */
	keep?: (partId: string) => boolean;
}

const goalsOf = (g: Goals): Goals => ({ targets: g.targets, minTargets: g.minTargets, stretchTargets: g.stretchTargets });

/**
 * Every place in a log, top down: each Slot's Task followed by its parts, round by round.
 * A part that would put a Task inside itself (a loop in old data) is left out, and so is
 * anything below MAX_DEPTH or past MAX_POSITIONS, so a bad tree never hangs a page.
 */
export function expand(tops: Top[], opts: ExpandOptions): Position[] {
	const out: Position[] = [];
	const walk = (
		at: { path: string; slotId: string; partId: string | null; taskId: string; sets: number | null; goals: Goals },
		depth: number,
		parent: string | null,
		round: Position['round'],
		above: Set<string>
	) => {
		if (out.length >= MAX_POSITIONS) return;
		const parts =
			depth < MAX_DEPTH
				? opts.partsOf(at.taskId).filter((p) => (!p.archived || opts.keep?.(p.id)) && p.childTaskId !== at.taskId && !above.has(p.childTaskId))
				: [];
		const rounds = parts.length && !opts.perSet(at.taskId) && at.sets && at.sets > 1 ? Math.min(at.sets, 50) : 1;
		out.push({ path: at.path, slotId: at.slotId, partId: at.partId, taskId: at.taskId, depth, parent, round, sets: at.sets, kids: parts.length, rounds, ...at.goals });
		const nextAbove = new Set([...above, at.taskId]);
		for (let r = 1; r <= rounds; r++)
			for (const p of parts)
				walk(
					{ path: childPath(at.path, rounds > 1 ? r : null, p.id), slotId: at.slotId, partId: p.id, taskId: p.childTaskId, sets: p.sets, goals: goalsOf(p) },
					depth + 1,
					at.path,
					rounds > 1 ? { n: r, of: rounds } : null,
					nextAbove
				);
	};
	for (const t of tops) if (t.taskId) walk({ path: t.slotId, slotId: t.slotId, partId: null, taskId: t.taskId, sets: t.sets, goals: goalsOf(t) }, 0, null, null, new Set());
	return out;
}

/** Is this the first place of a round, so a "Round 2 of 3" heading goes above it? */
export const startsRound = (positions: Position[], i: number): boolean => {
	const p = positions[i];
	if (!p.round) return false;
	const prev = positions.slice(0, i).reverse().find((x) => x.parent === p.parent);
	return !prev || prev.round?.n !== p.round.n;
};

/** One thing to do: a place with fields to fill in, or a plain Yes or no (no fields, no parts). */
export const isStep = (p: Pick<Position, 'kids'>, fieldCount: number) => fieldCount > 0 || p.kids === 0;

export interface Placed<E> {
	/** Entries by the path they sit at. */
	at: Map<string, E[]>;
	/** Entries no place in this log holds (a part removed since): kept, never dropped. */
	orphans: E[];
}

/**
 * Put a log's Entries in their places. An Entry with a path goes where it says. One from
 * before paths goes by its Task: to the only place with that Task, or, when there are
 * several, one group per place in order (see engine/groups.ts), as the log screen did.
 */
export function place<E extends { taskId: string; path?: string | null; values: Record<string, unknown> }>(
	positions: Pick<Position, 'path' | 'taskId'>[],
	entries: E[]
): Placed<E> {
	const at = new Map<string, E[]>();
	// A path holds the Entries of its own Task: a Slot that now uses another Task leaves the old one's aside.
	const known = new Map(positions.map((p) => [p.path, p.taskId]));
	const orphans: E[] = [];
	const add = (path: string, e: E) => at.set(path, [...(at.get(path) ?? []), e]);
	const legacy = new Map<string, E[]>();
	for (const e of entries) {
		if (e.path) {
			if (known.get(e.path) === e.taskId) add(e.path, e);
			else orphans.push(e);
		} else legacy.set(e.taskId, [...(legacy.get(e.taskId) ?? []), e]);
	}
	for (const [taskId, list] of legacy) {
		const spots = positions.filter((p) => p.taskId === taskId);
		if (!spots.length) orphans.push(...list);
		else if (spots.length === 1) for (const e of list) add(spots[0].path, e);
		else {
			const groups = slotGroups(list, taskId);
			groups.forEach((g, k) => {
				if (spots[k]) for (const e of g) add(spots[k].path, e);
				else orphans.push(...g);
			});
		}
	}
	return { at, orphans };
}

// ---------- editing: loops and depth ----------

/** Parts as tree edges: the child Task sits under the parent Task. A Task can have many parents. */
export const edgesOf = (parts: Pick<PartRow, 'taskId' | 'childTaskId'>[]): Node[] => parts.map((p) => ({ id: p.childTaskId, parentId: p.taskId }));

/** How many levels of parts sit below a Task (0 for a Task with none). Loops count as nothing more. */
export function heightOf(edges: Node[], taskId: string): number {
	const kids = childrenOf(edges);
	const go = (id: string, seen: Set<string>): number => {
		let h = 0;
		for (const k of kids.get(id) ?? []) if (!seen.has(k.id)) h = Math.max(h, 1 + go(k.id, new Set([...seen, k.id])));
		return h;
	};
	return go(taskId, new Set([taskId]));
}

/** How many Tasks a Task sits under at most (0 when it is in none). */
export function depthUnder(edges: Node[], taskId: string): number {
	const parents = new Map<string, string[]>();
	for (const e of edges) if (e.parentId) parents.set(e.id, [...(parents.get(e.id) ?? []), e.parentId]);
	const go = (id: string, seen: Set<string>): number => {
		let d = 0;
		for (const p of parents.get(id) ?? []) if (!seen.has(p)) d = Math.max(d, 1 + go(p, new Set([...seen, p])));
		return d;
	};
	return go(taskId, new Set([taskId]));
}

/**
 * What's wrong with giving `taskId` these children, against every other part of the account
 * (`others`, the Task's own current parts left out): a Task inside itself, or a tree deeper
 * than MAX_DEPTH. Null when it's fine.
 */
export function checkParts(others: Pick<PartRow, 'taskId' | 'childTaskId'>[], taskId: string, childIds: string[], name: (id: string) => string): string | null {
	const edges = edgesOf(others.filter((p) => p.taskId !== taskId));
	for (const c of childIds) {
		if (c === taskId) return "A Task can't be inside itself";
		if (descendants(edges, c).has(taskId)) return `${name(c)} already has this Task inside it, so it can't go inside this one`;
	}
	const below = Math.max(0, ...childIds.map((c) => 1 + heightOf(edges, c)));
	if (depthUnder(edges, taskId) + below > MAX_DEPTH) return `Tasks can sit inside each other up to ${MAX_DEPTH} levels deep`;
	return null;
}
