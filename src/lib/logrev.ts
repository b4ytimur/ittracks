// What a log holds, as a short fingerprint. A page sends the fingerprints its log grew from with
// every save, so the server can tell a save that would overwrite what another device, a quick-log
// link or an assistant wrote in between. It is worked out from the content, so nothing that writes
// a log has to remember to count.

export interface LogContent {
	entries: { taskId: string; path: string | null; values: Record<string, unknown> }[];
	notes: string;
	level: string;
}

/** JSON with its keys in order, so the same content always reads the same. */
const ordered = (v: unknown): string =>
	JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

const textOf = (c: LogContent) =>
	ordered({ e: c.entries.map((e) => [e.taskId, e.path ?? null, e.values]), n: c.notes ?? '', l: c.level || 'target' });

/** cyrb53, a 53-bit string hash: enough to see a change, and nothing depends on it being secret. */
export function revOf(c: LogContent): string {
	const s = textOf(c);
	let a = 0xdeadbeef;
	let b = 0x41c6ce57;
	for (let i = 0; i < s.length; i++) {
		const ch = s.charCodeAt(i);
		a = Math.imul(a ^ ch, 2654435761);
		b = Math.imul(b ^ ch, 1597334677);
	}
	a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
	b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
	return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
}

/** What differs between two versions of a log, in words: "Bench press", "the note", "the level". */
export function differs(mine: LogContent, theirs: LogContent, nameOf: (taskId: string) => string): string[] {
	const of = (c: LogContent, id: string) => ordered(c.entries.filter((e) => e.taskId === id).map((e) => [e.path ?? null, e.values]));
	const ids = [...new Set([...mine.entries, ...theirs.entries].map((e) => e.taskId))];
	return [
		...ids.filter((id) => of(mine, id) !== of(theirs, id)).map(nameOf),
		...(mine.notes !== theirs.notes ? ['the note'] : []),
		...(mine.level !== theirs.level ? ['the level'] : [])
	];
}
