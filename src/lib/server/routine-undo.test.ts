// Routines against a real (in-memory) database, after swarm round 5: Undo on a routine takes back
// only what its own Done or Skip marked, Clear takes its whole past day away, a routine inside a
// routine keeps its own rule, and skipping days in bulk says every habit it skips and leaves days
// with something logged alone.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from './db';
import { entry, habit, occurrence } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { loadToday, settleAll, userToday } from './today';
import { startFrom } from './backfill';
import { routineSteps } from './routine-day';
import { getHabitForm, saveHabit } from './repo/habits';
import { saveTask } from './repo/tasks';
import { habitForm, taskForm } from '$lib/forms';
import { addDays } from '$lib/engine/dates';
import { rollupRuleOf, type Schedule } from '$lib/engine/schedule';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';
import { clearOcc, doneOcc, reopenOcc, skipOcc } from './core/log';

let me: string;
let app: Actor;
let today: string;
const d = (n: number) => addDays(today, n);

const run = (name: string, input: unknown = {}) => runAction(app, name, input) as Record<string, unknown>;
const occOf = (habitId: string, date = today) =>
	db.select().from(occurrence).where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, date))).get()!;
const statuses = (ids: string[], date = today) => ids.map((id) => occOf(id, date)?.status ?? null);
const entriesOf = (occId: string) => db.select().from(entry).where(eq(entry.occurrenceId, occId)).orderBy(asc(entry.sortOrder)).all();
const save = (f: unknown) => saveHabit(me, null, habitForm.parse(f), today)!;

function routine(name: string, ago = 0, extra: Record<string, unknown> = {}) {
	const v = randomUUID();
	const start = d(-ago);
	return save({ name, direction: 'build', startDate: start, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'interval', every: 1, start, variantId: v }, ...extra });
}
function follower(name: string, parentId: string, ago = 0, slots: unknown[] = []) {
	const v = randomUUID();
	return save({ name, direction: 'build', startDate: d(-ago), variants: [{ id: v, name: 'Main', slots }], schedule: { kind: 'follow', variantId: v, on: null }, parentId });
}
function countTask(name: string) {
	const metricId = randomUUID();
	const id = saveTask(me, null, taskForm.parse({ name, restTimerEnabled: false, restTimerSeconds: 90, tags: [], metrics: [{ id: metricId, name: 'Pages', type: 'count', repeats: false }], parts: [] }))!;
	return { id, metricId };
}
const slotFor = (taskId: string, target: number, metricId: string) => ({ id: randomUUID(), taskId, fillRule: null, sets: null, targets: { [metricId]: target } });

type Answer = { summary: string; count: number; changes: { id: string; label: string; detail?: string }[]; skipped: { reason: string; items: { label: string; detail?: string }[] }[] };
const bulk = (input: unknown) => run('bulk', input) as unknown as Answer;
const reasons = (r: Answer) => Object.fromEntries(r.skipped.map((s) => [s.reason, s.items.map((i) => i.label)]));

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('routineundo', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
	app = appActor(me);
});

describe('Undo on a routine', () => {
	it('done only through the habits inside it: no Undo, and opening it again leaves them done', () => {
		const book = countTask('Book 1');
		const r = routine('Gym day');
		const gym = follower('Gym', r, 0, [slotFor(book.id, 20, book.metricId)]);
		loadToday(me, today);
		run('log_task', { habit: gym, task: 'Book 1', values: { Pages: 18 }, finish: 'yes' });
		const card = loadToday(me, today).build.find((x) => x.habitId === r)!;
		expect(card.occurrence?.status).toBe('done');
		expect(card.group).toMatchObject({ routine: true, undoable: false });
		expect(routineSteps(me, occOf(r).id)?.undoable).toBe(false);

		reopenOcc(app, occOf(r), false);
		expect(statuses([gym, r])).toEqual(['done', 'done']);
		expect(entriesOf(occOf(gym).id)).toHaveLength(1);
	});

	it('after its own Done, opens again what it marked and takes back what that tap wrote, also after a reload', () => {
		const book = countTask('Book 2');
		const r = routine('Evening');
		const read = follower('Read', r, 0, [slotFor(book.id, 12, book.metricId)]);
		const floss = follower('Floss', r);
		const plan = follower('Plan tomorrow', r);
		loadToday(me, today);
		doneOcc(app, occOf(plan), 'mark', null);
		expect(doneOcc(app, occOf(r), 'mark', null)).toBe('done');
		expect(statuses([read, floss, plan, r])).toEqual(['done', 'done', 'done', 'done']);
		expect(entriesOf(occOf(read).id).map((e) => e.values[book.metricId])).toEqual([12]);
		expect(loadToday(me, today).build.find((x) => x.habitId === r)?.group?.undoable).toBe(true);

		// The row's Undo, which knows nothing of how the day was logged.
		reopenOcc(app, occOf(r), false);
		expect(statuses([read, floss, plan, r])).toEqual(['due', 'due', 'done', 'due']);
		expect(entriesOf(occOf(read).id)).toEqual([]);
	});

	it('after its own Skip, opens again only what it skipped', () => {
		const r = routine('Wind down');
		const [a, b] = ['Stretch', 'Journal'].map((n) => follower(n, r));
		loadToday(me, today);
		skipOcc(app, occOf(a));
		skipOcc(app, occOf(r));
		expect(statuses([a, b, r])).toEqual(['skipped', 'skipped', 'skipped']);
		reopenOcc(app, occOf(r), false);
		expect(statuses([a, b, r])).toEqual(['skipped', 'due', 'due']);
	});

	it('a routine inside a routine: the outer Done marks both levels, and its Undo takes both back', () => {
		const outer = routine('Night');
		const inner = follower('Teeth', outer);
		const [brush, floss] = ['Brush', 'Floss 2'].map((n) => follower(n, inner));
		loadToday(me, today);
		expect(doneOcc(app, occOf(outer), 'mark', null)).toBe('done');
		expect(statuses([brush, floss, inner, outer])).toEqual(['done', 'done', 'done', 'done']);
		reopenOcc(app, occOf(outer), false);
		expect(statuses([brush, floss, inner, outer])).toEqual(['due', 'due', 'due', 'due']);
	});
});

describe('Clear on a past routine day', () => {
	it('takes the habits inside it away too, so the day is missed again', () => {
		const r = routine('Bedtime', 4);
		const [a, b] = ['Pyjamas on', 'Story'].map((n) => follower(n, r, 4));
		settleAll(me, today);
		run('log_done', { habit: r, date: d(-2) });
		expect(statuses([a, b, r], d(-2))).toEqual(['done', 'done', 'done']);
		const h = db.select().from(habit).where(eq(habit.id, r)).get()!;
		clearOcc(app, { habit: h as never, schedule: getHabitForm(me, r)!.schedule!, date: d(-2), today });
		expect(statuses([a, b, r], d(-2))).toEqual(['missed', 'missed', 'missed']);
	});
});

describe('a routine inside a routine', () => {
	it('keeps its own rule for the habits inside it: 2 of 3 is a done day', () => {
		const roster = routine('Roster');
		const v = randomUUID();
		const health = save({
			name: 'Shift-day health',
			direction: 'build',
			startDate: today,
			variants: [{ id: v, name: 'Main', slots: [] }],
			schedule: { kind: 'follow', variantId: v, on: null, rollup: { target: 2, minimum: 1 } },
			parentId: roster
		});
		const [water, meal, steps] = ['Water', 'Shift meal', 'Steps'].map((n) => follower(n, health));
		expect(rollupRuleOf(getHabitForm(me, health)!.schedule as Schedule)).toEqual({ target: 2, minimum: 1 });
		loadToday(me, today);
		run('log_done', { habit: water });
		run('log_done', { habit: meal });
		expect(statuses([water, meal, steps, health])).toEqual(['done', 'done', 'due', 'done']);
	});
});

describe('skipping days in bulk', () => {
	it('a routine with the habits inside it: the preview and the answer say all of them', () => {
		const r = routine('Evening routine');
		const kids = ['Meds PM', 'Hygiene PM', 'Prep tomorrow'].map((n) => follower(n, r));
		loadToday(me, today);
		// Selected the way a list ticks them: the habits inside first.
		const preview = bulk({ action: { name: 'skip_days', from: today, to: today }, ids: [...kids, r] });
		expect(preview.changes.map((c) => c.label).sort()).toEqual(['Evening routine', 'Hygiene PM', 'Meds PM', 'Prep tomorrow']);
		expect(preview.skipped).toEqual([]);
		expect(statuses([...kids, r])).toEqual(['due', 'due', 'due', 'due']);

		// Only the routine selected: the habits it skips are listed with it.
		const one = bulk({ action: { name: 'skip_days', from: today, to: today }, ids: [r], apply: true });
		expect(one.summary).toBe('Skipped 4 days of 4 habits');
		expect(one.changes.find((c) => c.label === 'Meds PM')?.detail).toMatch(/, with Evening routine$/);
		expect(statuses([...kids, r])).toEqual(['skipped', 'skipped', 'skipped', 'skipped']);
	});

	it('leaves a day with something logged as it is, and says so', () => {
		const book = countTask('Book 3');
		const v = randomUUID();
		const start = d(-5);
		const pills = save({ name: 'Antibiotic', direction: 'build', startDate: start, variants: [{ id: v, name: 'Main', slots: [slotFor(book.id, 2, book.metricId)] }], schedule: { kind: 'interval', every: 1, start, variantId: v } });
		settleAll(me, today);
		const half = occOf(pills, d(-3));
		expect(half.status).toBe('missed');
		db.insert(entry).values({ id: randomUUID(), occurrenceId: half.id, taskId: book.id, values: { [book.metricId]: 1 } }).run();
		const r = bulk({ action: { name: 'skip_days', from: d(-4), to: d(-2) }, ids: [pills], apply: true });
		expect(r.changes[0].detail).toMatch(/^2 days/);
		expect(reasons(r)['Something is logged on these days, so they stay as they are. Skip one on its day if you mean to']).toEqual(['Antibiotic']);
		expect(statuses([pills], d(-3))).toEqual(['missed']);
		expect(statuses([pills], d(-4))).toEqual(['skipped']);
	});

	it('a rotation that waits: a day it was due and missed can be skipped', () => {
		const [a, b] = [randomUUID(), randomUUID()];
		const start = d(-3);
		const feed = save({
			name: 'Feed Biscuit',
			direction: 'build',
			startDate: start,
			variants: [
				{ id: a, name: 'Wet', slots: [] },
				{ id: b, name: 'Dry', slots: [] }
			],
			schedule: { kind: 'rotation', step: 'variant', order: [{ variantId: a, restDays: 0 }, { variantId: b, restDays: 0 }], onMiss: 'wait', weekdays: [], start }
		});
		startFrom(db.select().from(habit).where(eq(habit.id, feed)).get()!, start);
		settleAll(me, today);
		expect(statuses([feed], d(-2))).toEqual(['missed']);
		const r = bulk({ action: { name: 'skip_days', from: d(-2), to: d(-2) }, ids: [feed], apply: true });
		expect(r.count).toBe(1);
		expect(statuses([feed], d(-2))).toEqual(['skipped']);
	});
});
