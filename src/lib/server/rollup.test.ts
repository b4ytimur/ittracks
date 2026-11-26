// Habit groups against a real (in-memory) database: a group's days come from the habits inside
// it, Today nests them, nothing logs on a group directly, and the tree stays sound.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { habit, occurrence } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { loadToday, settleAll, userToday } from './today';
import { dayCounts } from './days';
import { checkHabitEdit, checkLinks, deleteHabit, getHabitForm, saveHabit } from './repo/habits';
import { habitForm, type HabitForm } from '$lib/forms';
import { addDays } from '$lib/engine/dates';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';

let me: string;
let app: Actor;
let today: string;

const run = (name: string, input: unknown = {}) => runAction(app, name, input) as Record<string, unknown>;
const rowOn = (habitId: string, date: string) =>
	db.select().from(occurrence).where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, date))).get();

/** A daily tick-off habit that started `ago` days back, optionally inside a group. */
function daily(name: string, ago: number, parentId: string | null = null): string {
	const v = randomUUID();
	const start = addDays(today, -ago);
	return saveHabit(me, null, habitForm.parse({ name, direction: 'build', startDate: start, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'interval', every: 1, start, variantId: v }, parentId }), today)!;
}

function group(name: string, ago: number, rule: { target: number | null; minimum: number | null } = { target: null, minimum: null }, parentId: string | null = null): string {
	return saveHabit(me, null, habitForm.parse({ name, direction: 'build', startDate: addDays(today, -ago), variants: [], schedule: { kind: 'group', ...rule }, parentId }), today)!;
}

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('groups', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
	app = appActor(me);
});

describe('a group gets its days from the habits inside it', () => {
	it('done when all are done, missed when one was not, and due today until they are', () => {
		const g = group('Morning routine', 3);
		const a = daily('Meditate', 3, g);
		const b = daily('Stretch', 3, g);
		const d2 = addDays(today, -2);
		const d1 = addDays(today, -1);
		run('log_done', { habit: a, date: d2 });
		run('log_done', { habit: b, date: d2 });
		run('log_done', { habit: a, date: d1 });
		settleAll(me, today);
		expect(rowOn(g, d2)).toMatchObject({ status: 'done', rollup: { done: 2, total: 2 }, variantId: null });
		expect(rowOn(g, d1)).toMatchObject({ status: 'missed', rollup: { done: 1, total: 2 } });

		let t = loadToday(me, today);
		const card = t.build.find((x) => x.habitId === g)!;
		expect(card.occurrence?.status).toBe('due');
		expect(card.group).toMatchObject({ done: 0, total: 2, kids: [a, b] });
		expect(t.build.find((x) => x.habitId === a)?.parentId).toBe(g);

		run('log_done', { habit: a });
		t = loadToday(me, today);
		expect(t.build.find((x) => x.habitId === g)?.group).toMatchObject({ done: 1, total: 2 });
		run('log_done', { habit: b });
		t = loadToday(me, today);
		expect(t.build.find((x) => x.habitId === g)?.occurrence?.status).toBe('done');
		// The days block counts habits, not the group on top of them.
		expect(dayCounts(me, today, today)[today][1]).toBe(
			db.select().from(occurrence).innerJoin(habit, eq(occurrence.habitId, habit.id)).where(and(eq(habit.accountId, me), eq(occurrence.date, today))).all().filter((r) => r.occurrence.rollup === null && r.occurrence.status !== 'skipped').length
		);
	});

	it('a target of 1 of 2 is done with one; a Minimum makes a short past day done at the Minimum', () => {
		const any = group('Any movement', 2, { target: 1, minimum: null });
		const walk = daily('Walk', 2, any);
		daily('Swim', 2, any);
		run('log_done', { habit: walk, date: addDays(today, -1) });
		const min = group('Evening', 2, { target: null, minimum: 1 });
		const read = daily('Read', 2, min);
		daily('Journal', 2, min);
		run('log_done', { habit: read, date: addDays(today, -1) });
		settleAll(me, today);
		expect(rowOn(any, addDays(today, -1))?.status).toBe('done');
		expect(rowOn(min, addDays(today, -1))).toMatchObject({ status: 'done', level: 'minimum' });
	});

	it('groups sit in groups: the inner one counts as one habit of the outer one', () => {
		const outer = group('Health', 1);
		const inner = group('Gym day', 1, { target: null, minimum: null }, outer);
		const lift = daily('Lift', 1, inner);
		const water = daily('Water', 1, outer);
		run('log_done', { habit: lift, date: addDays(today, -1) });
		run('log_done', { habit: water, date: addDays(today, -1) });
		settleAll(me, today);
		expect(rowOn(inner, addDays(today, -1))?.status).toBe('done');
		expect(rowOn(outer, addDays(today, -1))).toMatchObject({ status: 'done', rollup: { done: 2, total: 2 } });
	});

	it('moving a habit out applies from today on: past group days keep the habits they had', () => {
		const g = group('Mind', 2);
		const a = daily('Breathe', 2, g);
		const b = daily('Gratitude', 2, g);
		run('log_done', { habit: a, date: addDays(today, -1) });
		settleAll(me, today);
		expect(rowOn(g, addDays(today, -1))).toMatchObject({ status: 'missed', rollup: { done: 1, total: 2 } });
		saveHabit(me, b, { ...getHabitForm(me, b)!, parentId: null }, today);
		loadToday(me, today);
		expect(rowOn(g, addDays(today, -1))).toMatchObject({ status: 'missed', rollup: { done: 1, total: 2 } });
		// From today on it counts only what is inside now.
		expect(rowOn(g, today)).toMatchObject({ rollup: { done: 0, total: 1 } });
		run('log_done', { habit: a });
		expect(rowOn(g, today)).toMatchObject({ status: 'done', rollup: { done: 1, total: 1 } });
	});
});

describe('what a group refuses', () => {
	it("can't be logged directly, from the API or the app's occurrence routes", () => {
		const g = group('Refuses', 1);
		daily('Inside', 1, g);
		loadToday(me, today);
		expect(() => run('log_done', { habit: g })).toThrow(/is a group/);
		expect(() => run('log_skip', { habit: g })).toThrow(/is a group/);
	});

	it('keeps the tree sound: groups only, no loops, no logs crossing into a group', () => {
		const g = group('Outer', 1);
		const inner = group('Inner', 1, { target: null, minimum: null }, g);
		const plain = daily('Plain', 1);
		const f = (id: string) => getHabitForm(me, id)!;
		expect(checkLinks(me, g, { ...f(g), parentId: inner })).toMatch(/inside itself/);
		expect(checkLinks(me, g, { ...f(g), parentId: plain })).toMatch(/inside another group/);
		run('log_done', { habit: plain });
		const asGroup: HabitForm = { ...f(plain), variants: [], schedule: { kind: 'group', target: null, minimum: null } };
		expect(checkHabitEdit(me, plain, asGroup)).toMatch(/has logs/);
		const back: HabitForm = { ...f(g), schedule: { kind: 'interval', every: 1, start: today, variantId: randomUUID() } };
		expect(checkHabitEdit(me, g, back)).toMatch(/Move the habits inside/);
	});

	it('deleting a group moves what was inside it to the top level', () => {
		const g = group('Temporary', 1);
		const a = daily('Stays', 1, g);
		deleteHabit(me, g);
		expect(db.select({ parentId: habit.parentId }).from(habit).where(eq(habit.id, a)).get()?.parentId).toBeNull();
	});
});

describe('export and import', () => {
	it('restores groups before the habits inside them, with new ids', async () => {
		const { exportJson, importReplace } = await import('./core/export');
		const file = JSON.parse(JSON.stringify(exportJson(app)));
		// Children listed first, as a crafted or reordered file could.
		file.tables.habit.reverse();
		const other = await createAccount('groups-copy', 'another long password');
		const r = importReplace(appActor(other), file);
		expect(r.renumbered).toBe(true);
		const rows = db.select().from(habit).where(eq(habit.accountId, other)).all();
		const byName = new Map(rows.map((h) => [h.name, h]));
		expect(byName.get('Meditate')?.parentId).toBe(byName.get('Morning routine')?.id);
		expect(byName.get('Gym day')?.parentId).toBe(byName.get('Health')?.id);
	});
});
