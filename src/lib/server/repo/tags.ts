// Renaming a tag (a member of a grouping). Tasks point at it; auto-fill rules, smart Collections, saved
// views and Stats filters know it by name, so they are renamed with it. Refused when the new name is
// taken or still named by one of those, since the way back would not be exact then.
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { collection, habit, settings, slot, tag, variant } from '../db/schema';
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
