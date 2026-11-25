// A habit's Area counts from the day it changes, like a move into a group: Stats
// keep crediting its past days to the Area they had, "past days too" puts them all in the new one,
// and a bulk Area change does the same as the editor's.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { habit } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { settleAll, userToday } from './today';
import { getHabitForm, saveHabit } from './repo/habits';
import { addArea } from './repo/areas';
import { patchHabit } from './habit-patch';
import { restoreSnapshot } from './snapshot';
import { writeHabitFields } from './bulk/habit-fields';
import { ctxFor, getStats, loadDataset } from './stats';
import { computeCard, prepare } from '$lib/stats/engine';
import { makeCard } from '$lib/stats/model';
import { habitForm } from '$lib/forms';
import { addDays } from '$lib/engine/dates';
import { areaOn, keepValue } from '$lib/engine/dated';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';

let me: string;
let app: Actor;
let today: string;
let aarav: string;
let maya: string;
const d = (n: number) => addDays(today, n);
const run = (name: string, input: unknown = {}) => runAction(app, name, input) as Record<string, unknown>;

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('areahistory', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
	app = appActor(me);
	aarav = addArea(me, 'Aarav')!.id;
	maya = addArea(me, 'Maya')!.id;
});

/** A daily chore in Aarav's Area, done on three past days. */
function chore(name: string) {
	const v = randomUUID();
	const id = saveHabit(me, null, habitForm.parse({ name, direction: 'build', startDate: d(-10), areaId: aarav, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'interval', every: 1, start: d(-10), variantId: v } }), today)!;
	settleAll(me, today);
	for (const n of [-5, -3, -1]) run('log_done', { habit: id, date: d(n) });
	return id;
}
/** "Who did how many": times done in the last 30 days, split by Area, for one habit. */
function whoDid(habitId: string): Record<string, number | null> {
	const P = prepare(loadDataset(me));
	const r = computeCard(makeCard({ what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', split: 'area', range: '30d', filter: { habits: [habitId] }, look: { chart: 'bars' } }), P, ctxFor(today, getStats(me)));
	return Object.fromEntries(r.series.map((s) => [s.label, s.total]));
}
/** Times done in the last 30 days with only one Area picked. */
function inArea(habitId: string, areaId: string): number | null {
	const P = prepare(loadDataset(me));
	return computeCard(makeCard({ what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', range: '30d', filter: { habits: [habitId], areas: [areaId] } }), P, ctxFor(today, getStats(me))).total;
}
const area = (habitId: string, areaId: string | null, applies: 'today' | 'past' = 'today') =>
	patchHabit(me, habitId, { set: { areaId }, was: { areaId: getHabitForm(me, habitId)!.areaId }, applies, keep: applies === 'past' }, today) as { undo?: string };

describe("a habit's Area over time", () => {
	it('a change counts from today on: past days stay with the Area they had', () => {
		const trash = chore('Take out trash');
		expect(whoDid(trash)).toEqual({ Aarav: 3 });
		area(trash, maya);
		run('log_done', { habit: trash });
		expect(whoDid(trash)).toEqual({ Aarav: 3, Maya: 1 });
		expect([inArea(trash, aarav), inArea(trash, maya)]).toEqual([3, 1]);
		expect(db.select({ e: habit.earlierAreas }).from(habit).where(eq(habit.id, trash)).get()!.e).toEqual([{ until: d(-1), areaId: aarav }]);
	});

	it('past days too puts every day in the new Area, and its Undo puts them back', () => {
		const dishes = chore('Dishes');
		area(dishes, maya);
		const r = area(dishes, maya, 'past');
		expect(whoDid(dishes)).toEqual({ Maya: 3 });
		expect(r.undo && restoreSnapshot(me, r.undo)).toBe(true);
		expect(whoDid(dishes)).toEqual({ Aarav: 3 });
	});

	it('changing back the same day leaves no trace', () => {
		const plants = chore('Water the plants');
		area(plants, maya);
		area(plants, aarav);
		expect(db.select({ e: habit.earlierAreas }).from(habit).where(eq(habit.id, plants)).get()!.e).toBeNull();
		expect(whoDid(plants)).toEqual({ Aarav: 3 });
	});

	it('a bulk Area change counts from today on too, and its Undo leaves no trace', () => {
		const laundry = chore('Laundry');
		writeHabitFields(laundry, { areaId: aarav }, { areaId: maya });
		expect(whoDid(laundry)).toEqual({ Aarav: 3 });
		writeHabitFields(laundry, { areaId: maya }, { areaId: aarav });
		expect(db.select({ e: habit.earlierAreas }).from(habit).where(eq(habit.id, laundry)).get()!.e).toBeNull();
	});

	it('reads the Area on a day', () => {
		const earlier = keepValue('areaId', null, 'a', 'b', '2026-11-01', '2026-11-20');
		expect(earlier).toEqual([{ until: '2026-11-19', areaId: 'a' }]);
		expect([areaOn({ areaId: 'b', earlierAreas: earlier }, '2026-11-19'), areaOn({ areaId: 'b', earlierAreas: earlier }, '2026-11-20')]).toEqual(['a', 'b']);
		// A habit with no past days yet keeps nothing.
		expect(keepValue('areaId', null, 'a', 'b', '2026-11-20', '2026-11-20')).toBeNull();
	});
});
