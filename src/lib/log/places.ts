// What is being logged, by where it sits: a place's path and the Task in it. Never by its number
// in the list, so a swap, a reroll or a part added elsewhere never moves another place's values.
import { rowText, type Field } from './run';

export interface At {
	path: string;
	task: { id: string } | null;
}

export const placeKey = (it: At) => `${it.path}|${it.task?.id ?? ''}`;

/** A draft's places. One from before this kept a list, which fits only a log as long as it was. */
export function fromDraft<S>(saved: S[] | Record<string, S>, items: At[]): Record<string, S> {
	if (!Array.isArray(saved)) return saved;
	return saved.length === items.length ? Object.fromEntries(items.map((it, i) => [placeKey(it), saved[i]])) : {};
}

/** What a log saves at a place: a set, a place's once-per-log values, or a tick. */
export interface Logged {
	taskId: string;
	path: string | null;
	values: Record<string, unknown>;
}

/**
 * What a log saves besides the places it shows: what each place it no longer shows held when it
 * last did (`held`, by place: a swap, Pick another or a reload took it away before that reached the
 * server), then what the server holds that no place shows, unless `held` has that place, since what
 * a place held grew from what was saved there. A place shown that the server has no place for (a swap
 * still waiting to be sent, see `withWaiting`) holds what the server has there itself.
 */
export function besides<E extends Logged>(held: Record<string, E[]>, shown: At[], orphans: E[]): E[] {
	const here = new Set(shown.map(placeKey));
	const gone = new Set(Object.keys(held).filter((k) => !here.has(k)));
	const key = (e: E) => `${e.path}|${e.taskId}`;
	return [...[...gone].flatMap((k) => held[k]), ...orphans.filter((e) => !gone.has(key(e)) && !here.has(key(e)))];
}

/**
 * A log's places with the swaps still waiting to be sent (made offline) in place of their Slot's Task (and its
 * parts), where this page holds that Task's fields and last time (`onDevice`). What the server holds for that Task
 * there sits among its `orphans` until the swap reaches it: the place starts from it, so it is neither hidden nor
 * saved twice (see `besides`). The Slot's targets stay: they name its own Task's fields, so they show only on it.
 */
export function withWaiting<I extends At & { slotId: string; depth: number; kids: number; saved: Record<string, unknown>[]; previous: Record<string, unknown>[] }>(
	items: I[],
	picks: Record<string, string>,
	onDevice: (id: string) => { task: I['task']; previous: Record<string, unknown>[] } | undefined,
	orphans: Logged[]
): I[] {
	return items.flatMap((it) => {
		const pick = picks[it.slotId];
		const d = pick ? onDevice(pick) : undefined;
		if (!d?.task || pick === items.find((x) => x.slotId === it.slotId && x.depth === 0)?.task?.id) return [it];
		if (it.depth) return [];
		const saved = orphans.filter((e) => e.path === it.path && e.taskId === pick && !(e.values._summary === true && Object.keys(e.values).length === 1)).map((e) => e.values);
		return [{ ...it, kids: 0, task: d.task, previous: d.previous, saved }];
	});
}

/** A set: neither a place's once-per-log values nor a Yes or no tick. */
export const isSet = (v: Record<string, unknown>) => v._summary !== true && !(v.done === true && Object.keys(v).length === 1);

/**
 * What was done at a place with another Task before its Slot was swapped, by that Task: its sets
 * (0 when it has only once-per-log values or a tick). `extra` is what the log saves besides the
 * places it shows (see `besides`); what sits at no place shown is gone from the habit instead.
 */
export function doneBefore(extra: Logged[], it: At): { taskId: string; sets: number }[] {
	const out = new Map<string, number>();
	for (const e of extra) if (e.path === it.path && e.taskId !== it.task?.id) out.set(e.taskId, (out.get(e.taskId) ?? 0) + (isSet(e.values) ? 1 : 0));
	return [...out].map(([taskId, sets]) => ({ taskId, sets }));
}

/** What a log holds that sits at no place it shows: gone from the habit (a part removed), not done before a swap. */
export const goneFrom = <E extends { path: string | null }>(extra: E[], shown: { path: string }[]) => extra.filter((e) => !shown.some((it) => it.path === e.path));

/** A Slot's line for a Task done there before a swap, in that Task's own words: "Bench press · 2 sets done". */
export const doneLine = (name: string, sets: number, one: string, many: string) => `${name} · ${sets ? `${sets} ${sets === 1 ? one : many} ` : ''}done`;

/** The sets a Task swapped in still has to do: the Slot's planned count less those done before, at least 1. */
export const setsToDo = (planned: number, done: number) => (done ? Math.max(1, planned - done) : planned);

/**
 * The band's line for a swap or Pick another. `scope` is "today only", or a past day's date and "only".
 * Back to the plan's own Task, it says so instead.
 */
export function swapText(was: string | null, now: string, how: 'swap' | 'back' | 'reroll', scope: string): string {
	if (how === 'back') return `Back to ${now}, as planned.`;
	return `${how === 'reroll' ? 'Picked' : 'Using'} ${now}${was ? ` instead of ${was}` : ''}, ${scope}.`;
}

/** A Task done in a Slot in place of the plan's, as a past log lists it: "Incline bench press · instead of Bench press". */
export const insteadLine = (name: string, plan: string | null | undefined) => (plan ? `${name} · instead of ${plan}` : name);

/** A field as a swap matches it to another Task's: by name and unit, and of the same kind. */
interface Named {
	id: string;
	name: string;
	type: string;
	unit: string | null;
}
// ponytail: a Choice's values are its own options' ids, so no Choice carries over.
const sameField = (a: Named, b: Named) => a.type === b.type && a.type !== 'choice' && a.name.trim().toLowerCase() === b.name.trim().toLowerCase() && (a.unit ?? '') === (b.unit ?? '');

/**
 * What a Task swapped in, with no last time of its own, starts from: the values the Task it replaces still had to
 * do, row by row, in the fields whose name and unit match. `ids`: the fields that got a value ("From Bench press").
 */
export function carryOver(from: Named[], rows: Record<string, unknown>[], to: Named[]): { rows: Record<string, unknown>[]; ids: string[] } {
	const pairs = to.flatMap((m) => from.filter((f) => sameField(f, m)).slice(0, 1).map((f) => [m.id, f.id] as const));
	const out = rows.map((r) => Object.fromEntries(pairs.filter(([, f]) => r[f] !== undefined && r[f] !== null && r[f] !== '').map(([m, f]) => [m, r[f]])));
	return { rows: out, ids: pairs.map(([m]) => m).filter((m) => out.some((r) => m in r)) };
}

/** The number most of these rows hold in a field; on a tie, the one held last. None without a number. */
function most(rows: Record<string, unknown>[], id: string): number | undefined {
	const n = new Map<number, number>();
	let best: number | undefined;
	for (const r of rows) {
		const v = r[id];
		if (typeof v !== 'number' || !Number.isFinite(v)) continue;
		n.set(v, (n.get(v) ?? 0) + 1);
		if (best === undefined || n.get(v)! >= n.get(best)!) best = v;
	}
	return best;
}

/**
 * The targets a Task aims for once it is a Slot's own (Keep in the plan, Replace…): only in the fields the Task it
 * replaces had a target in, matched by name and unit (none had one: none). Each is what most of `today`'s rows of it
 * (its done sets, its once-per-log values) used, on a tie the last one's; with none, its `last` time's; else none.
 */
export function aimFor(from: Named[], targets: Record<string, number>, to: Named[], today: Record<string, unknown>[], last: Record<string, unknown>[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const m of to) {
		if (!from.some((f) => targets[f.id] !== undefined && sameField(f, m))) continue;
		const v = most(today, m.id) ?? most(last, m.id);
		if (v !== undefined) out[m.id] = v;
	}
	return out;
}

/** What a log holds of a Task at a place, shown there or done before a swap took it away: the `today` of aimFor. */
export const loggedAt = (entries: Logged[], task: string, path: string) => entries.filter((e) => e.taskId === task && e.path === path).map((e) => e.values);

/** What a Slot aims for, as the band says it: "4 × 50 kg × 8", its once-per-log targets after. "" with no targets. */
export function aimText(sets: number | null, fields: (Field & { repeats: boolean })[], targets: Record<string, number>): string {
	if (!Object.keys(targets).length) return '';
	const row = rowText(fields.filter((f) => f.repeats), targets);
	return [row && sets ? `${sets} × ${row}` : row, rowText(fields.filter((f) => !f.repeats), targets)].filter(Boolean).join(' · ');
}

/** The band's line for a Task kept in the plan, naming the Variant: "Replaced Bench press with Incline bench press in Push day A, from now on." */
export const keptText = (was: string, now: string, variant: string, aim: string) => `Replaced ${was} with ${now} in ${variant}, from now on${aim ? `, aiming for ${aim}` : ''}.`;

/** A Task used in a Slot before, as its ⋯ and the picker say it: "Used here 12 Nov · 8 × 50 kg". */
export const usedText = (u: { date: string; text: string }, day: (date: string) => string) => `Used here ${day(u.date)}${u.text ? ` · ${u.text}` : ''}`;

/** A Task of the Library as the swap picker has it. */
export interface Pickable {
	id: string;
	name: string;
	archived: boolean;
	tags: string[];
	/** When it was last done, and its first set that day in words ("50 kg × 8", or ""), or null. */
	last: { date: string; text: string } | null;
}
export interface PickRow {
	id: string;
	name: string;
	meta: string;
	disabled: boolean;
}

/**
 * The swap picker's rows: "Used here before", then "Like Bench press" (up to 5 sharing a Tag with it, the most Tags
 * first), then the rest of the Library A–Z. Each Task once; the one in use and archived ones never; a search keeps
 * the names that hold it. `away`: a Task that can't be swapped to now (offline, its fields not on this device).
 */
export function swapGroups(o: {
	library: Pickable[];
	used: { taskId: string; date: string; text: string }[];
	like: { id: string; name: string } | null;
	current: string | null;
	query: string;
	day: (date: string) => string;
	away: (id: string) => boolean;
}): { label: string; rows: PickRow[] }[] {
	const open = o.library.filter((t) => !t.archived && t.id !== o.current);
	const row = (t: Pickable, meta: string): PickRow => (o.away(t.id) ? { id: t.id, name: t.name, meta: 'Needs a connection', disabled: true } : { id: t.id, name: t.name, meta, disabled: false });
	const lastText = (t: Pickable) => (t.last ? `Last ${t.last.text || o.day(t.last.date)}` : 'Never done');
	const used = o.used.flatMap((u) => open.filter((t) => t.id === u.taskId).map((t) => row(t, usedText(u, o.day))));
	const taken = new Set(used.map((r) => r.id));
	const tags = new Set(o.library.find((t) => t.id === o.like?.id)?.tags ?? []);
	const shared = (t: Pickable) => t.tags.filter((x) => tags.has(x)).length;
	const like = open
		.filter((t) => !taken.has(t.id) && t.id !== o.like?.id && shared(t))
		.sort((a, b) => shared(b) - shared(a) || a.name.localeCompare(b.name))
		.slice(0, 5);
	for (const t of like) taken.add(t.id);
	const rest = open.filter((t) => !taken.has(t.id)).sort((a, b) => a.name.localeCompare(b.name));
	const q = o.query.trim().toLowerCase();
	return [
		{ label: 'Used here before', rows: used },
		{ label: `Like ${o.like?.name}`, rows: like.map((t) => row(t, lastText(t))) },
		{ label: 'In the Library', rows: rest.map((t) => row(t, lastText(t))) }
	]
		.map((g) => ({ ...g, rows: g.rows.filter((r) => r.name.toLowerCase().includes(q)) }))
		.filter((g) => g.rows.length);
}
