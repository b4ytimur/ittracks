import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { craving, habit, habitIdentity, identity, occurrence } from '../db/schema';
import { weekStart } from '$lib/engine/dates';

export function listIdentities(accountId: string) {
	return db
		.select({ id: identity.id, statement: identity.statement })
		.from(identity)
		.where(eq(identity.accountId, accountId))
		.orderBy(asc(identity.sortOrder), asc(identity.createdAt))
		.all();
}

export function addIdentity(accountId: string, statement: string) {
	const id = randomUUID();
	const count = listIdentities(accountId).length;
	db.insert(identity).values({ id, accountId, statement, sortOrder: count }).run();
	return id;
}

/** Two statements are one identity when they read the same, whatever the case or the spaces around them. */
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Find an Identity by its exact statement, or create it. Used by template import. */
export function identityFor(accountId: string, statement: string) {
	const hit = listIdentities(accountId).find((i) => same(i.statement, statement));
	return hit?.id ?? addIdentity(accountId, statement);
}

/** Change an identity's sentence: false, and nothing changed, when another one already says it (as adding it finds that one). */
export function renameIdentity(accountId: string, id: string, statement: string): boolean {
	if (listIdentities(accountId).some((i) => i.id !== id && same(i.statement, statement))) return false;
	db.update(identity)
		.set({ statement })
		.where(and(eq(identity.id, id), eq(identity.accountId, accountId)))
		.run();
	return true;
}

/** Put them in this order; any not named keep theirs after these. */
export function orderIdentities(accountId: string, ids: string[]) {
	const own = listIdentities(accountId).map((i) => i.id);
	const next = [...ids.filter((id, i) => own.includes(id) && ids.indexOf(id) === i), ...own.filter((id) => !ids.includes(id))];
	db.transaction((tx) => next.forEach((id, sortOrder) => tx.update(identity).set({ sortOrder }).where(and(eq(identity.id, id), eq(identity.accountId, accountId))).run()));
}

export interface DeletedIdentity {
	id: string;
	statement: string;
	sortOrder: number;
	habitIds: string[];
}

/** Delete an identity and say what it was, so it can be put back. */
export function deleteIdentity(accountId: string, id: string): DeletedIdentity | null {
	return db.transaction((tx) => {
		const row = tx.select().from(identity).where(and(eq(identity.id, id), eq(identity.accountId, accountId))).get();
		if (!row) return null;
		const habitIds = tx.select({ id: habitIdentity.habitId }).from(habitIdentity).where(eq(habitIdentity.identityId, id)).all().map((x) => x.id);
		tx.delete(identity).where(eq(identity.id, id)).run();
		return { id, statement: row.statement, sortOrder: row.sortOrder, habitIds };
	});
}

export function restoreIdentity(accountId: string, d: DeletedIdentity) {
	db.transaction((tx) => {
		tx.insert(identity).values({ id: d.id, accountId, statement: d.statement, sortOrder: d.sortOrder }).onConflictDoNothing().run();
		if (!tx.select({ id: identity.id }).from(identity).where(and(eq(identity.id, d.id), eq(identity.accountId, accountId))).get()) return;
		const own = new Set(tx.select({ id: habit.id }).from(habit).where(eq(habit.accountId, accountId)).all().map((h) => h.id));
		for (const habitId of d.habitIds) if (own.has(habitId)) tx.insert(habitIdentity).values({ habitId, identityId: d.id }).onConflictDoNothing().run();
	});
}

export interface IdentityVotes {
	id: string;
	statement: string;
	habits: { id: string; name: string }[];
	week: number;
	total: number;
}

/**
 * Each done Occurrence of a linked build habit is one vote, at any level.
 * Each craving resisted on a linked break habit is one vote too.
 */
export function identityVotes(accountId: string, today: string): IdentityVotes[] {
	const ids = listIdentities(accountId);
	if (!ids.length) return [];
	const links = db
		.select({ identityId: habitIdentity.identityId, habitId: habit.id, name: habit.name })
		.from(habitIdentity)
		.innerJoin(habit, eq(habitIdentity.habitId, habit.id))
		.where(and(eq(habit.accountId, accountId), eq(habit.archived, false)))
		.all();
	const habitIds = [...new Set(links.map((l) => l.habitId))];
	const votes = habitIds.length
		? [
				...db
					.select({ habitId: occurrence.habitId, date: occurrence.date })
					.from(occurrence)
					.where(and(inArray(occurrence.habitId, habitIds), eq(occurrence.status, 'done')))
					.all(),
				...db
					.select({ habitId: craving.habitId, date: craving.date })
					.from(craving)
					.where(inArray(craving.habitId, habitIds))
					.all()
			]
		: [];
	const monday = weekStart(today);
	return ids.map((i) => {
		const mine = new Set(links.filter((l) => l.identityId === i.id).map((l) => l.habitId));
		const v = votes.filter((x) => mine.has(x.habitId));
		return {
			...i,
			habits: links.filter((l) => l.identityId === i.id).map((l) => ({ id: l.habitId, name: l.name })),
			week: v.filter((x) => x.date >= monday && x.date <= today).length,
			total: v.length
		};
	});
}

/** Identity statements per Habit, for showing on cards. */
export function identitiesByHabit(accountId: string): Map<string, string[]> {
	const rows = db
		.select({ habitId: habitIdentity.habitId, statement: identity.statement })
		.from(habitIdentity)
		.innerJoin(identity, eq(habitIdentity.identityId, identity.id))
		.where(eq(identity.accountId, accountId))
		.all();
	const out = new Map<string, string[]>();
	for (const r of rows) out.set(r.habitId, [...(out.get(r.habitId) ?? []), r.statement]);
	return out;
}


