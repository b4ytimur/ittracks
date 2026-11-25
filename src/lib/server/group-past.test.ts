// Moving a habit with a past into a group or routine (swarm round 5): from today on by default,
// or for its past days too, with a group reaching back to the habit's start and an Undo.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { habit, occurrence } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { loadToday, userToday } from './today';
import { getHabitForm, saveHabit } from './repo/habits';
import { moveHabit } from './habit-actions';
import { restoreSnapshot } from './snapshot';
import { habitForm, type HabitForm } from '$lib/forms';
import { addDays } from '$lib/engine/dates';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';

let me: string;
let app: Actor;
let today: string;
const d = (n: number) => addDays(today, n);

const run = (name: string, input: unknown = {}) => runAction(app, name, input) as Record<string, unknown>;
const rowOn = (habitId: string, date: string) =>
	db.select().from(occurrence).where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, date))).get();
const save = (f: unknown) => saveHabit(me, null, habitForm.parse(f), today)!;
const edit = (id: string, patch: Partial<HabitForm>, applies: 'today' | 'past' = 'today') =>
	saveHabit(me, id, { ...getHabitForm(me, id)!, ...patch }, today, { scheduleApplies: applies });
const habitRow = (id: string) => db.select().from(habit).where(eq(habit.id, id)).get()!;

function daily(name: string, ago: number) {
	const v = randomUUID();
	const start = d(-ago);
	return save({ name, direction: 'build', startDate: start, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'interval', every: 1, start, variantId: v } });
}
const group = (name: string, ago: number) => save({ name, direction: 'build', startDate: d(-ago), variants: [], schedule: { kind: 'group', target: null, minimum: null } });

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('grouppast', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
	app = appActor(me);
});

describe('a habit with a past put in a group', () => {
	it('counts from today on by default; past days too gives the group its past, and Undo takes it back', () => {
		const lectures = daily('Math lectures', 6);
		for (const n of [6, 5, 3, 2, 1]) run('log_done', { habit: lectures, date: d(-n) });
		const math = group('Math', 0);

		expect(moveHabit(me, lectures, math, today)).toEqual({ parentId: math });
		expect(habitRow(lectures).earlierParents).toEqual([{ until: d(-1), parentId: null }]);
		loadToday(me, today);
		expect(rowOn(math, d(-2))).toBeUndefined();

		const r = moveHabit(me, lectures, math, today, 'past');
		expect(r).toMatchObject({ parentId: math, groupStart: d(-6) });
		expect(habitRow(lectures).earlierParents).toBeNull();
		expect(habitRow(math).startDate).toBe(d(-6));
		expect(rowOn(math, d(-2))).toMatchObject({ status: 'done' });
		expect(rowOn(math, d(-4))).toMatchObject({ status: 'missed' });

		expect(restoreSnapshot(me, (r as { undo: string }).undo)).toBe(true);
		expect(habitRow(lectures).earlierParents).toEqual([{ until: d(-1), parentId: null }]);
		expect(habitRow(math).startDate).toBe(today);
	});

	it('a group that already reaches back keeps its start; moving from another group counts every day in the new one', () => {
		const sheet = daily('Problem sheet', 4);
		const old = group('Old', 10);
		const cs = group('CS', 10);
		moveHabit(me, sheet, old, today);
		const r = moveHabit(me, sheet, cs, today, 'past');
		expect(r).toMatchObject({ parentId: cs, groupStart: null });
		expect(habitRow(sheet).earlierParents).toBeNull();
		expect(habitRow(cs).startDate).toBe(d(-10));
	});

	it('the editor: past days too on the Inside line, and a plan that follows its routine for past days too', () => {
		const v = randomUUID();
		const start = d(-5);
		const routine = save({ name: 'Morning routine', direction: 'build', startDate: start, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'interval', every: 1, start, variantId: v } });
		const walk = daily('Walk', 5);
		edit(walk, { parentId: routine }, 'past');
		expect(habitRow(walk).earlierParents).toBeNull();
		// A routine keeps its own start.
		expect(habitRow(routine).startDate).toBe(start);

		// Moved in from today on first, then set to follow the routine for past days too.
		const meds = daily('Meds AM', 5);
		edit(meds, { parentId: routine });
		expect(habitRow(meds).earlierParents).toEqual([{ until: d(-1), parentId: null }]);
		const mv = getHabitForm(me, meds)!.variants[0].id;
		edit(meds, { schedule: { kind: 'follow', variantId: mv, on: null } }, 'past');
		expect(habitRow(meds).earlierParents).toBeNull();
	});
});
