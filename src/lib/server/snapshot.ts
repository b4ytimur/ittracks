// Undo for changes that rewrite past days. A snapshot holds the rows as they were and as the change
// left them; putting it back touches only rows that are still as the change left them, so a log made
// since is never lost.
import { and, eq, inArray, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { entry, habit, habitIdentity, occurrence, slot, undoSnapshot, variant } from './db/schema';
import { descendants } from '$lib/engine/tree';

type Row = Record<string, unknown> & { id: string };
interface Rows {
	habit: Row[];
	identities: { habitId: string; identityId: string }[];
	variant: Row[];
	slot: Row[];
	occurrence: Row[];
}
interface Snapshot {
	habitId: string;
	before: Rows;
	after: Rows;
}
const KEEP_MS = 24 * 3600_000;

/** A habit, what it sits in (now and before), and everything inside it: a change can judge all of them again. */
function familyOf(accountId: string, habitId: string): string[] {
	const all = db.select({ id: habit.id, parentId: habit.parentId }).from(habit).where(eq(habit.accountId, accountId)).all();
	const out = new Set([habitId, ...descendants(all, habitId)]);
	for (let up = all.find((h) => h.id === habitId)?.parentId; up && !out.has(up); up = all.find((h) => h.id === up)?.parentId) out.add(up);
	return [...out];
}

function rowsOf(ids: string[]): Rows {
	const variants = ids.length ? db.select().from(variant).where(inArray(variant.habitId, ids)).all() : [];
	return {
		habit: ids.length ? (db.select().from(habit).where(inArray(habit.id, ids)).all() as Row[]) : [],
		identities: ids.length ? db.select().from(habitIdentity).where(inArray(habitIdentity.habitId, ids)).all() : [],
		variant: variants as Row[],
		slot: variants.length ? (db.select().from(slot).where(inArray(slot.variantId, variants.map((v) => v.id))).all() as Row[]) : [],
		occurrence: ids.length ? (db.select().from(occurrence).where(inArray(occurrence.habitId, ids)).all() as Row[]) : []
	};
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Run a change on a habit and keep what it replaced. Returns the snapshot's id with the change's result. */
export function withSnapshot<T>(accountId: string, habitId: string, change: () => T, now = Date.now()): { result: T; undo: string } {
	const ids = familyOf(accountId, habitId);
	const before = rowsOf(ids);
	const result = change();
	const after = rowsOf([...new Set([...ids, ...familyOf(accountId, habitId)])]);
	const id = randomUUID();
	db.delete(undoSnapshot).where(lt(undoSnapshot.createdAt, new Date(now - KEEP_MS))).run();
	db.insert(undoSnapshot).values({ id, accountId, data: { habitId, before, after } satisfies Snapshot }).run();
	return { result, undo: id };
}

/** Dates come back from JSON as text. */
const revive = (r: Row): Row => ({ ...r, ...Object.fromEntries(['createdAt', 'finishedAt', 'deleteAfter'].flatMap((k) => (typeof r[k] === 'string' ? [[k, new Date(r[k] as string)]] : []))) });

/** Put it back. False when the habit was changed again since, or the snapshot is gone. */
export function restoreSnapshot(accountId: string, id: string): boolean {
	const row = db.select().from(undoSnapshot).where(and(eq(undoSnapshot.id, id), eq(undoSnapshot.accountId, accountId))).get();
	if (!row) return false;
	const { habitId, before, after } = row.data as Snapshot;
	if (!habitId) return false;
	const at = <R extends { id: string }>(rows: R[], k: string) => rows.find((r) => r.id === k);
	const plain = (r: unknown) => JSON.parse(JSON.stringify(r));
	// The plan has to be as the change left it: settling days since moves only `settledThrough`.
	const plan = (r: Row | undefined) => {
		const { settledThrough: _, ...rest } = plain(r ?? { id: '' });
		return rest;
	};
	const now = rowsOf([...new Set([...before.habit, ...after.habit].map((h) => h.id))]);
	const mine = now.habit.find((h) => h.id === habitId);
	if (!mine || mine.accountId !== accountId || !same(plan(mine), plan(at(after.habit, habitId)))) return false;
	const ofMine = (r: Rows) => {
		const vs = r.variant.filter((v) => v.habitId === habitId);
		return plain([vs, r.slot.filter((x) => vs.some((v) => v.id === x.variantId)), r.identities.filter((x) => x.habitId === habitId).map((x) => x.identityId).sort()]);
	};
	if (!same(ofMine(now), ofMine(after))) return false;
	// A Variant that came with the change goes with it, unless a day was logged on it since.
	const goes = new Set(now.variant.filter((v) => v.habitId === habitId && !at(before.variant, v.id)).map((v) => v.id));
	const onIt = now.occurrence.filter((o) => goes.has(o.variantId as string));
	const logs = onIt.length ? new Set(db.select({ id: entry.occurrenceId }).from(entry).where(inArray(entry.occurrenceId, onIt.map((o) => o.id).slice(0, 900))).all().map((e) => e.id)) : new Set<string>();
	if (onIt.some((o) => logs.has(o.id) || ((o.status === 'done' || o.status === 'skipped') && !same(plain(o), plain(at(after.occurrence, o.id) ?? null))))) return false;

	db.transaction((tx) => {
		const was = revive(at(before.habit, habitId)!);
		tx.update(habit).set(was as never).where(eq(habit.id, habitId)).run();
		// Variants and Slots, without deleting one first: past days point at them.
		const vs = before.variant.filter((v) => v.habitId === habitId);
		for (const v of vs) tx.insert(variant).values(v as never).onConflictDoUpdate({ target: variant.id, set: v as never }).run();
		const keep = new Set(vs.map((v) => v.id));
		for (const v of now.variant.filter((v) => v.habitId === habitId && !keep.has(v.id))) tx.delete(variant).where(eq(variant.id, v.id)).run();
		const slots = before.slot.filter((x) => keep.has(x.variantId as string));
		for (const x of slots) tx.insert(slot).values(x as never).onConflictDoUpdate({ target: slot.id, set: x as never }).run();
		for (const x of now.slot.filter((x) => keep.has(x.variantId as string) && !slots.some((y) => y.id === x.id))) tx.delete(slot).where(eq(slot.id, x.id)).run();
		tx.delete(habitIdentity).where(eq(habitIdentity.habitId, habitId)).run();
		for (const x of before.identities.filter((x) => x.habitId === habitId)) tx.insert(habitIdentity).values(x).onConflictDoNothing().run();
		const logged = (oid: string) => !!tx.select({ id: entry.id }).from(entry).where(eq(entry.occurrenceId, oid)).get();
		// Days that came with the change, or were planned and settled by it since: nobody logged them.
		const gone = new Set<string>();
		for (const o of now.occurrence) {
			if (at(before.occurrence, o.id)) continue;
			const left = at(after.occurrence, o.id);
			const planned = o.habitId === habitId && (o.status === 'missed' || o.status === 'due') && !o.notes;
			if (!(left ? same(plain(o), plain(left)) : planned) || logged(o.id)) continue;
			tx.delete(occurrence).where(eq(occurrence.id, o.id)).run();
			gone.add(o.id);
		}
		// Days of this habit and of those judged with it: only the ones still as the change left them.
		const rest = now.occurrence.filter((o) => !gone.has(o.id));
		for (const o of before.occurrence) {
			const left = at(after.occurrence, o.id);
			const cur = at(rest, o.id);
			if (cur && left && same(plain(cur), plain(left)) && !same(plain(cur), plain(o))) tx.update(occurrence).set(revive(o) as never).where(eq(occurrence.id, o.id)).run();
			else if (!cur && !left && !rest.some((x) => x.habitId === o.habitId && x.date === o.date)) tx.insert(occurrence).values(revive(o) as never).onConflictDoNothing().run();
		}
		tx.delete(undoSnapshot).where(eq(undoSnapshot.id, id)).run();
	});
	return true;
}
