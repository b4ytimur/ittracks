// Habits inside groups: a tree kept as parent links. Pure, so the server, the editor and the
// tests share it. A broken link (a parent that is gone, or a loop in old data) never hangs:
// every walk stops at a habit it has already seen.

export interface Node {
	id: string;
	parentId: string | null;
}

/** Every habit below `id`, at any depth. */
export function descendants(nodes: Node[], id: string): Set<string> {
	const kids = childrenOf(nodes);
	const out = new Set<string>();
	const walk = (at: string) => {
		for (const { id: k } of kids.get(at) ?? []) {
			if (out.has(k) || k === id) continue;
			out.add(k);
			walk(k);
		}
	};
	walk(id);
	return out;
}

/** Would putting `id` inside `parentId` make a loop? */
export function makesCycle(nodes: Node[], id: string, parentId: string): boolean {
	return parentId === id || descendants(nodes, id).has(parentId);
}

/** How deep a habit sits: 0 at the top level. */
export function depthOf(nodes: Node[], id: string): number {
	const parent = new Map(nodes.map((n) => [n.id, n.parentId]));
	const seen = new Set<string>([id]);
	let d = 0;
	for (let p = parent.get(id) ?? null; p && parent.has(p) && !seen.has(p); p = parent.get(p) ?? null) {
		seen.add(p);
		d++;
	}
	return d;
}

/** The ids ordered deepest first, so a group is worked out after the groups inside it. */
export function deepestFirst<T extends Node>(nodes: T[], all: Node[] = nodes): T[] {
	const depth = new Map(nodes.map((n) => [n.id, depthOf(all, n.id)]));
	return [...nodes].sort((a, b) => depth.get(b.id)! - depth.get(a.id)!);
}

/** Children by parent id, in the order given. */
export function childrenOf<T extends Node>(nodes: T[]): Map<string, T[]> {
	const out = new Map<string, T[]>();
	for (const n of nodes) if (n.parentId) out.set(n.parentId, [...(out.get(n.parentId) ?? []), n]);
	return out;
}

/**
 * A list put in tree order: each habit followed by what is inside it, with its depth. A habit
 * whose parent isn't in the list sits at the top level.
 */
export function flatten<T extends Node>(nodes: T[]): { node: T; depth: number }[] {
	const ids = new Set(nodes.map((n) => n.id));
	const kids = childrenOf(nodes.filter((n) => n.parentId && ids.has(n.parentId)));
	const out: { node: T; depth: number }[] = [];
	const seen = new Set<string>();
	const walk = (n: T, depth: number) => {
		if (seen.has(n.id)) return;
		seen.add(n.id);
		out.push({ node: n, depth });
		for (const k of kids.get(n.id) ?? []) walk(k, depth + 1);
	};
	for (const n of nodes) if (!n.parentId || !ids.has(n.parentId)) walk(n, 0);
	// Anything left is in a loop in old data: show it at the top level rather than lose it.
	for (const n of nodes) walk(n, 0);
	return out;
}

/**
 * A list as a tree: the top-level habits, and what sits directly inside each one, in the order
 * given. For views that nest one list inside another. A habit whose parent isn't in the list
 * sits at the top level, and a loop in old data is cut where it closes, so every habit shows once.
 */
export function forest<T extends Node>(nodes: T[]): { roots: T[]; kids: Map<string, T[]> } {
	const ids = new Set(nodes.map((n) => n.id));
	const all = childrenOf(nodes.filter((n) => n.parentId && ids.has(n.parentId)));
	const roots: T[] = [];
	const kids = new Map<string, T[]>();
	const seen = new Set<string>();
	const place = (n: T) => {
		const mine = (all.get(n.id) ?? []).filter((k) => !seen.has(k.id));
		for (const k of mine) seen.add(k.id);
		if (mine.length) kids.set(n.id, mine);
		for (const k of mine) place(k);
	};
	for (const n of nodes)
		if (!n.parentId || !ids.has(n.parentId)) {
			seen.add(n.id);
			roots.push(n);
		}
	for (const r of [...roots]) place(r);
	for (const n of nodes)
		if (!seen.has(n.id)) {
			seen.add(n.id);
			roots.push(n);
			place(n);
		}
	return { roots, kids };
}
