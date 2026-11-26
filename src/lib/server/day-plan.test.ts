// A Slot's Task swapped for one day, or picked again for an auto-filled Slot: what the day holds,
// how it goes back, and which Task what was logged counts for. Against a real (in-memory) database.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { entry, habit, metric, occurrence, slot, task, variant } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';
import { todayFor } from './core/log';
import { ownTask, rerollSlot, swapSlot } from './day-plan';
import { lastEntries } from './today';
import { recapFor } from './stats';
import { finishAs, keepGoals, progressForIds, verdictsFor } from './progress';
import { addDays } from '$lib/engine/dates';

let me: string;
let app: Actor;
let today: string;
let bench: string;
let incline: string;
let fixed: typeof slot.$inferSelect;
let auto: typeof slot.$inferSelect;

const taskId = (name: string) => db.select().from(task).where(and(eq(task.accountId, me), eq(task.name, name))).get()!.id;
const field = (t: string, name: string) => db.select().from(metric).where(and(eq(metric.taskId, t), eq(metric.name, name))).get()!.id;
const gym = () => db.select().from(habit).where(and(eq(habit.accountId, me), eq(habit.name, 'Gym'))).get()!;
const day = (date: string) => db.select().from(occurrence).where(and(eq(occurrence.habitId, gym().id), eq(occurrence.date, date))).get()!;
const picks = () => day(today).picks ?? {};
const set = (occ: string, t: string, path: string, kg: number, n: number) =>
	db.insert(entry).values({ id: randomUUID(), occurrenceId: occ, taskId: t, path, values: { [field(t, 'Weight')]: kg, [field(t, 'Reps')]: 8 }, sortOrder: n }).run();
const lift = (name: string) => ({
	op: 'add_task',
	task: { name, metrics: [{ name: 'Weight', type: 'number', unit: 'kg', repeats: true }, { name: 'Reps', type: 'count', repeats: true }] }
});

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('swap-tester', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	app = appActor(me);
	today = todayFor(app);
	runAction(app, 'setup', {
		changes: [
			lift('Bench press'),
			lift('Incline bench press'),
			lift('Squat'),
			lift('Lunge'),
			{
				op: 'add_habit',
				habit: {
					name: 'Gym',
					startDate: addDays(today, -1),
					schedule: { kind: 'interval', every: 1 },
					variants: [{ name: 'Push day A', slots: [{ taskId: 'Bench press', sets: 4, targets: { Weight: 60 } }, { taskId: null, fillRule: {} }] }]
				}
			}
		],
		apply: true
	});
	// Habits that count only their full target: a Slot left at nothing would be a miss.
	db.update(habit).set({ minimumCounts: false }).where(eq(habit.id, gym().id)).run();
	bench = taskId('Bench press');
	incline = taskId('Incline bench press');
	const v = db.select().from(variant).where(eq(variant.habitId, gym().id)).get()!;
	[fixed, auto] = db.select().from(slot).where(eq(slot.variantId, v.id)).orderBy(slot.sortOrder).all();
	// Bench press last time, yesterday.
	runAction(app, 'log_task', { habit: 'Gym', date: 'yesterday', task: 'Bench press', sets: [{ Weight: 57.5, Reps: 8 }] });
	db.update(occurrence).set({ status: 'done', finishedAt: new Date() }).where(eq(occurrence.id, day(addDays(today, -1)).id)).run();
	runAction(app, 'today', {});
});

describe('swapping a Slot for the day', () => {
	it('swapping back to the plan\'s own Task clears the swap, so a later change to the plan reaches the day', () => {
		swapSlot(app, day(today), fixed.id, incline);
		expect(picks()[fixed.id]).toBe(incline);
		swapSlot(app, day(today), fixed.id, bench);
		expect(fixed.id in picks()).toBe(false);
		// Swapped twice, then back: still no swap left.
		swapSlot(app, day(today), fixed.id, incline);
		swapSlot(app, day(today), fixed.id, taskId('Lunge'));
		expect(picks()[fixed.id]).toBe(taskId('Lunge'));
		swapSlot(app, day(today), fixed.id, incline);
		expect(picks()[fixed.id]).toBe(incline);
		swapSlot(app, day(today), fixed.id, bench);
		expect(fixed.id in picks()).toBe(false);
		// The auto-filled Slot keeps its pick all along.
		expect(picks()[auto.id]).toBeTruthy();
	});

	it('a Slot\'s own Task is the one its log kept, else the plan\'s; an auto-filled Slot has none', () => {
		expect(ownTask({ goals: null }, fixed.id, fixed)).toBe(bench);
		expect(ownTask({ goals: { [fixed.id]: { taskId: incline, sets: 4, targets: null, minTargets: null, stretchTargets: null } } }, fixed.id, fixed)).toBe(incline);
		expect(ownTask({ goals: null }, auto.id, auto)).toBeNull();
		// A Slot gone from the plan that the log kept.
		expect(ownTask({ goals: { gone: { taskId: bench, sets: null, targets: null, minTargets: null, stretchTargets: null } } }, 'gone', undefined)).toBe(bench);
		expect(ownTask({ goals: null }, 'gone', undefined)).toBeNull();
	});

	it('Pick another, then back to the Task it showed before: an auto-filled Slot keeps that one as its pick', () => {
		const before = picks()[auto.id];
		const next = rerollSlot(app, day(today), auto.id);
		expect(next).not.toBe(before);
		swapSlot(app, day(today), auto.id, before);
		expect(picks()[auto.id]).toBe(before);
	});

	it('what was done with each Task counts for that Task, and the Slot counts as done', () => {
		const occ = day(today);
		// Two sets of Bench press, then swapped for Incline bench press; the auto-filled Slot done too.
		set(occ.id, bench, fixed.id, 60, 0);
		set(occ.id, bench, fixed.id, 60, 1);
		set(occ.id, picks()[auto.id], auto.id, 40, 2);
		swapSlot(app, occ, fixed.id, incline);
		// Bench press's sets are the Slot's: the habit isn't short of it, nor of Bench press's 60 kg target.
		expect(progressForIds([occ.id]).get(occ.id)).toEqual({ kind: 'steps', done: 2, total: 2 });
		expect(verdictsFor([occ.id]).get(occ.id)).toBe('full');
		set(occ.id, incline, fixed.id, 50, 3);
		set(occ.id, incline, fixed.id, 50, 4);
		db.update(occurrence).set({ status: 'done', finishedAt: new Date() }).where(eq(occurrence.id, occ.id)).run();
		expect(finishAs(occ.id, today)).toBe('done');

		// Incline's next prefill, Last time and recap are today's.
		const fresh = randomUUID();
		expect(lastEntries(incline, fresh, fixed.id)).toEqual([{ [field(incline, 'Weight')]: 50, [field(incline, 'Reps')]: 8 }, { [field(incline, 'Weight')]: 50, [field(incline, 'Reps')]: 8 }]);
		expect(recapFor(me, [incline], fresh, today)[incline]?.date).toBe(today);
		// Bench press counts the two sets done with it, and nothing of Incline's.
		expect(lastEntries(bench, fresh)).toHaveLength(2);
		expect(recapFor(me, [bench], fresh, today)[bench]?.date).toBe(today);
	});

	it('a swap with nothing done before it leaves the plan\'s Task its last time', () => {
		const tomorrow = addDays(today, 1);
		db.insert(occurrence).values({ id: randomUUID(), habitId: gym().id, date: tomorrow, status: 'due', variantId: fixed.variantId }).run();
		const occ = day(tomorrow);
		swapSlot(app, occ, fixed.id, incline);
		set(occ.id, incline, fixed.id, 52.5, 0);
		db.update(occurrence).set({ status: 'done', finishedAt: new Date() }).where(eq(occurrence.id, occ.id)).run();
		const fresh = randomUUID();
		expect(recapFor(me, [incline], fresh, tomorrow)[incline]?.date).toBe(tomorrow);
		expect(recapFor(me, [bench], fresh, tomorrow)[bench]?.date).toBe(today);
		expect(lastEntries(bench, fresh)[0][field(bench, 'Weight')]).toBe(60);
	});

	it('a finished log keeps its swap when the plan changes, and back to the Task it kept is no swap', () => {
		const occ = day(today);
		db.transaction((tx) => keepGoals(tx, [fixed.variantId]));
		// The plan's Slot uses Squat from now on; today's log keeps Bench press as its own.
		db.update(slot).set({ taskId: taskId('Squat') }).where(eq(slot.id, fixed.id)).run();
		expect(day(today).goals?.[fixed.id]?.taskId).toBe(bench);
		expect(progressForIds([occ.id]).get(occ.id)).toEqual({ kind: 'steps', done: 2, total: 2 });
		expect(verdictsFor([occ.id]).get(occ.id)).toBe('full');
		swapSlot(app, day(today), fixed.id, taskId('Squat'));
		expect(picks()[fixed.id]).toBe(taskId('Squat'));
		swapSlot(app, day(today), fixed.id, bench);
		expect(fixed.id in picks()).toBe(false);
	});
});
