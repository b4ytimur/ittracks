// Writing bulk-editable habit fields (habitBulk in rules/habit.ts), for a bulk change and for its
// Undo alike: each field's column, and what else a change to it does, as the habit editor's
// save does it. Undo writes the old values through the same function, so a field with an effect
// (days nobody logged) is put back with its effect too.
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { habit } from '../db/schema';
import { settledAfter } from '../repo/habits';
import type { HabitBulkField } from '$lib/rules/habit';

type Values = Partial<Record<HabitBulkField, unknown>>;
type Unlogged = 'missed' | 'ignore';

/** The habit column each bulk field is saved to. A new field without one is a type error. */
const COLUMN = { areaId: 'areaId', remind: 'remind', streakRule: 'streakRule', unlogged: 'unlogged' } satisfies Record<HabitBulkField, keyof typeof habit.$inferInsert>;

/**
 * What a change does besides its column, as columns to write with it. Days nobody logged:
 * ignoring them takes the misses written for them away, counting them again recounts from the
 * start on the next settle (repo/habits.ts settledAfter, as the editor's save).
 */
const EFFECT: Partial<Record<HabitBulkField, (id: string, from: unknown, to: unknown) => Partial<typeof habit.$inferInsert>>> = {
	unlogged: (id, from, to) => {
		const h = db.select({ startDate: habit.startDate }).from(habit).where(eq(habit.id, id)).get();
		if (!h) return {};
		return settledAfter(db, id, { startDate: h.startDate, unlogged: from as Unlogged }, { startDate: h.startDate, unlogged: to as Unlogged });
	}
};

/** The fields' values as the habit's row holds them now. */
export function habitFieldsNow(id: string, fields: HabitBulkField[]): Values | null {
	const row = db.select().from(habit).where(eq(habit.id, id)).get();
	if (!row) return null;
	return Object.fromEntries(fields.map((k) => [k, row[COLUMN[k]] ?? null]));
}

/** Change a habit's bulk fields from `from` to `to`, with what each change does besides. */
export function writeHabitFields(id: string, from: Values, to: Values) {
	const set: Partial<typeof habit.$inferInsert> = {};
	for (const k of Object.keys(to) as HabitBulkField[]) {
		Object.assign(set, { [COLUMN[k]]: to[k] ?? null });
		Object.assign(set, EFFECT[k]?.(id, from[k], to[k]));
	}
	db.update(habit).set(set).where(eq(habit.id, id)).run();
}
