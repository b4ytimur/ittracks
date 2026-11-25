// Tags, the members of a grouping: adding, moving and removing one, used by Settings and setup.
// Renaming a tag (a member of a grouping). Tasks point at it; auto-fill rules, smart Collections, saved
// views and Stats filters know it by name, so they are renamed with it. Refused when the new name is
// taken or still named by one of those, since the way back would not be exact then.
import { randomUUID } from 'node:crypto';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { collection, habit, settings, slot, tag, taskTag, variant } from '../db/schema';
import { getGroupings } from '../settings';
import type { FillRule } from '$lib/engine/fill';

type Json = unknown;
/** Every list of tag names in the settings: `tags` on a view, a board or a card. */
function eachTags(v: Json, f: (tags: string[]) => string[]): Json {
	if (Array.isArray(v)) return v.map((x) => eachTags(x, f));
	if (!v || typeof v !== 'object') return v;
	return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'tags' && Array.isArray(x) && x.every((t) => typeof t === 'string') ? f(x) : eachTags(x, f)]));
}
const low = (s: string) => s.toLowerCase();
const inRule = (r: FillRule) => [...Object.keys(r.must ?? {}), ...Object.keys(r.mustNot ?? {}), ...(r.prefer ?? [])];

export function renameTag(accountId: string, id: string, value: string): { was: string; name: string } | { error: string } {
	const name = value.trim().slice(0, 40);
	const all = db.select().from(tag).where(eq(tag.accountId, accountId)).all();
	const t = all.find((x) => x.id === id);
	if (!t) return { error: 'That one is gone.' };
	if (!name) return { error: 'Give it a name.' };
	const from = t.name;
	if (name === from) return { was: from, name };
	if (all.some((x) => x.id !== id && low(x.name) === low(name))) return { error: `${name} is already in a grouping.` };
	return db.transaction((tx) => {
		const rules = tx
			.select({ id: slot.id, rule: slot.fillRule })
			.from(slot)
			.innerJoin(variant, eq(slot.variantId, variant.id))
			.innerJoin(habit, eq(variant.habitId, habit.id))
			.where(and(eq(habit.accountId, accountId), isNotNull(slot.fillRule)))
			.all()
			.map((r) => ({ id: r.id, rule: r.rule as FillRule }));
		const filters = tx.select().from(collection).where(and(eq(collection.accountId, accountId), isNotNull(collection.filter))).all();
		const own = tx.select().from(settings).where(eq(settings.accountId, accountId)).get();
		const named: string[] = filters.flatMap((c) => c.filter!.tags);
		eachTags(own?.data, (tags) => (named.push(...tags), tags));
		if (rules.some((r) => inRule(r.rule).includes(name)) || (low(name) !== low(from) && named.some((n) => low(n) === low(name)))) return { error: `An auto-fill rule, a Collection or a filter already says “${name}”. Pick another name.` };

		const word = (n: string) => (n === from ? name : n);
		const words = (tags: string[]) => tags.map((n) => (low(n) === low(from) ? name : n));
		const keys = (r: Record<string, number> | undefined) => r && Object.fromEntries(Object.entries(r).map(([k, v]) => [word(k), v]));
		tx.update(tag).set({ name }).where(eq(tag.id, id)).run();
		for (const r of rules)
			if (inRule(r.rule).includes(from))
				tx.update(slot)
					.set({ fillRule: { ...r.rule, must: keys(r.rule.must), mustNot: keys(r.rule.mustNot), prefer: r.rule.prefer?.map(word) } })
					.where(eq(slot.id, r.id))
					.run();
		for (const c of filters) tx.update(collection).set({ filter: { ...c.filter!, tags: words(c.filter!.tags) } }).where(eq(collection.id, c.id)).run();
		if (own) tx.update(settings).set({ data: eachTags(own.data, words) as typeof own.data }).where(eq(settings.accountId, accountId)).run();
		return { was: from, name };
	});
}

type Refusal = { error: string; status: 400 | 404 };
const mineTag = (accountId: string, id: string) => and(eq(tag.id, id), eq(tag.accountId, accountId));

/** A member for a grouping: a tag no Task has yet. */
export function addTag(accountId: string, value: string, grouping: string): { id: string } | Refusal {
	const name = value.trim().slice(0, 40);
	if (!name) return { error: 'Give it a name.', status: 400 };
	if (!getGroupings(accountId).some((g) => g.id === grouping)) return { error: 'That grouping is gone.', status: 404 };
	if (db.select({ name: tag.name }).from(tag).where(eq(tag.accountId, accountId)).all().some((t) => low(t.name) === low(name))) return { error: `${name} is already in a grouping.`, status: 400 };
	const id = randomUUID();
	db.insert(tag).values({ id, accountId, name, grouping }).run();
	return { id };
}

/** Put a member in another grouping (null: in none). Its Tasks keep their level. */
export function moveTag(accountId: string, id: string, grouping: string | null): { was: string | null } | Refusal {
	if (grouping && !getGroupings(accountId).some((g) => g.id === grouping)) return { error: 'That grouping is gone.', status: 404 };
	const t = db.select().from(tag).where(mineTag(accountId, id)).get();
	if (!t) return { error: 'That one is gone.', status: 404 };
	db.update(tag).set({ grouping }).where(mineTag(accountId, id)).run();
	return { was: t.grouping };
}

/** Remove a member no Task has. */
export function removeTag(accountId: string, id: string): { removed: typeof tag.$inferSelect } | Refusal {
	const t = db.select().from(tag).where(mineTag(accountId, id)).get();
	if (!t) return { error: 'That one is gone.', status: 404 };
	if (db.select().from(taskTag).where(eq(taskTag.tagId, id)).get()) return { error: 'A Task has it, so it stays.', status: 400 };
	db.delete(tag).where(mineTag(accountId, id)).run();
	return { removed: t };
}

/** Every tag with its grouping. */
export const listTags = (accountId: string) => db.select().from(tag).where(eq(tag.accountId, accountId)).all();
