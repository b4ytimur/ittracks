// History policies against a real (in-memory) database: what an edit of a Task or a habit may do
// to data already logged. Units convert or keep their numbers, removed fields and sub-tasks with
// logs are archived, locked fields stay put, and build or break is fixed once something is logged.
import { takePack } from './packs';
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, sql } from 'drizzle-orm';
import { db } from './db';
import { entry, habit, metric, occurrence, slot, task, taskPart } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { userToday } from './today';
import { getTaskForm, PastEditError, saveTask } from './repo/tasks';
import { getHabitForm, saveHabit } from './repo/habits';
import { habitLogged, taskLogged } from './history';
import { stepsOf } from './progress';
import { habitForm, taskForm, type TaskForm } from '$lib/forms';
import { addDays } from '$lib/engine/dates';
import { raise } from '$lib/engine/progression';

let me: string;
let today: string;

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('history', 'correct horse battery');
	takePack(me, 'gym'); // kg and lb convert
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
});

/** A Task (weight and reps per set, a sub-task), a habit using it, and one logged day. */
function gym(opts: { log?: boolean } = { log: true }) {
	const ids = { weight: randomUUID(), reps: randomUUID(), sub: randomUUID(), variant: randomUUID(), slot: randomUUID(), occ: randomUUID() };
	const taskId = saveTask(
		me,
		null,
		taskForm.parse({
			name: `Bench ${ids.weight.slice(0, 4)}`,
			restTimerEnabled: false,
			restTimerSeconds: 90,
			tags: [],
			metrics: [
				{ id: ids.weight, name: 'Weight', type: 'number', unit: 'kg', repeats: true },
				{ id: ids.reps, name: 'Reps', type: 'count', repeats: true }
			],
			parts: [{ kind: 'step', id: ids.sub, name: 'Warm-up' }]
		})
	)!;
	const habitId = saveHabit(
		me,
		null,
		habitForm.parse({
			name: 'Gym',
			direction: 'build',
			startDate: addDays(today, -10),
			variants: [{ id: ids.variant, name: 'A', slots: [{ id: ids.slot, taskId, fillRule: null, sets: 3, targets: { [ids.weight]: 100, [ids.reps]: 5 } }] }],
			schedule: { kind: 'frequency', times: 3, period: 'week', variantId: ids.variant }
		}),
		today
	)!;
	if (opts.log) {
		db.insert(occurrence)
			.values({
				id: ids.occ,
				habitId,
				variantId: ids.variant,
				date: addDays(today, -2),
				status: 'done',
				// The targets this day aimed for, kept when they changed later.
				goals: { [ids.slot]: { taskId, sets: 3, targets: { [ids.weight]: 90, [ids.reps]: 5 }, minTargets: null, stretchTargets: null } }
			})
			.run();
		db.insert(entry).values({ id: randomUUID(), occurrenceId: ids.occ, taskId, values: { [ids.weight]: 100, [ids.reps]: 5 }, sortOrder: 0 }).run();
		db.insert(entry).values({ id: randomUUID(), occurrenceId: ids.occ, taskId: ids.sub, values: { done: true }, sortOrder: 1 }).run();
	}
	return { ...ids, taskId, habitId };
}

const form = (taskId: string) => getTaskForm(me, taskId)!;
const withMetric = (f: TaskForm, id: string, patch: Partial<TaskForm['metrics'][number]>): TaskForm => ({
	...f,
	metrics: f.metrics.map((m) => (m.id === id ? { ...m, ...patch } : m))
});
const valuesOf = (taskId: string) => db.select().from(entry).where(eq(entry.taskId, taskId)).all().map((e) => e.values);
const slotRow = (id: string) => db.select().from(slot).where(eq(slot.id, id)).get()!;
const occRow = (id: string) => db.select().from(occurrence).where(eq(occurrence.id, id)).get()!;

describe('what is logged', () => {
	it('knows which fields have values and which steps were ticked', () => {
		const g = gym();
		const l = taskLogged(g.taskId);
		expect([...l.metrics].sort()).toEqual([g.weight, g.reps].sort());
		expect([...l.parts]).toEqual([g.sub]);
		expect(habitLogged(g.habitId)).toBe(true);
		expect(habitLogged(gym({ log: false }).habitId)).toBe(false);
	});
});

describe('unit change on a field with logged values', () => {
	it('asks first: saving without a choice is refused', () => {
		const g = gym();
		expect(() => saveTask(me, g.taskId, withMetric(form(g.taskId), g.weight, { unit: 'lb' }))).toThrow(PastEditError);
		expect(form(g.taskId).metrics.find((m) => m.id === g.weight)!.unit).toBe('kg');
	});

	it('convert: logged values, Slot targets and the targets kept with past logs all become lb', () => {
		const g = gym();
		saveTask(me, g.taskId, withMetric(form(g.taskId), g.weight, { unit: 'lb' }), undefined, { units: { [g.weight]: 'convert' } });
		expect(form(g.taskId).metrics.find((m) => m.id === g.weight)!.unit).toBe('lb');
		expect(valuesOf(g.taskId)[0]).toEqual({ [g.weight]: 220.462, [g.reps]: 5 });
		expect(slotRow(g.slot).targets).toEqual({ [g.weight]: 220.462, [g.reps]: 5 });
		expect(occRow(g.occ).goals![g.slot].targets).toEqual({ [g.weight]: 198.416, [g.reps]: 5 });
		// And back: three decimals convert back to the same kilograms.
		saveTask(me, g.taskId, withMetric(form(g.taskId), g.weight, { unit: 'kg' }), undefined, { units: { [g.weight]: 'convert' } });
		expect(valuesOf(g.taskId)[0][g.weight]).toBeCloseTo(100, 2);
	});

	it('keep the numbers: only the label changes', () => {
		const g = gym();
		saveTask(me, g.taskId, withMetric(form(g.taskId), g.weight, { unit: 'lb' }), undefined, { units: { [g.weight]: 'relabel' } });
		expect(form(g.taskId).metrics.find((m) => m.id === g.weight)!.unit).toBe('lb');
		expect(valuesOf(g.taskId)[0][g.weight]).toBe(100);
		expect(slotRow(g.slot).targets![g.weight]).toBe(100);
	});

	it("can't convert units of different kinds; keeping the numbers still works", () => {
		const g = gym();
		const f = withMetric(form(g.taskId), g.weight, { unit: 'plates' });
		expect(() => saveTask(me, g.taskId, f, undefined, { units: { [g.weight]: 'convert' } })).toThrow(PastEditError);
		saveTask(me, g.taskId, f, undefined, { units: { [g.weight]: 'relabel' } });
		expect(valuesOf(g.taskId)[0][g.weight]).toBe(100);
	});

	it('another spelling of the same unit is not a change, and a field with no logs changes freely', () => {
		const g = gym();
		saveTask(me, g.taskId, withMetric(form(g.taskId), g.weight, { unit: 'KGS' }));
		expect(valuesOf(g.taskId)[0][g.weight]).toBe(100);
		const fresh = gym({ log: false });
		saveTask(me, fresh.taskId, withMetric(form(fresh.taskId), fresh.weight, { unit: 'lb' }));
		expect(form(fresh.taskId).metrics.find((m) => m.id === fresh.weight)!.unit).toBe('lb');
	});
});

describe('locked once logged', () => {
	it('a logged number can become a count or a duration, never text or a tick', () => {
		const g = gym();
		expect(() => saveTask(me, g.taskId, withMetric(form(g.taskId), g.reps, { type: 'text' }))).toThrow(/read as another kind/);
		saveTask(me, g.taskId, withMetric(form(g.taskId), g.reps, { type: 'number' }));
		expect(form(g.taskId).metrics.find((m) => m.id === g.reps)!.type).toBe('number');
	});

	it('"Log per set" is fixed once logged, free before', () => {
		const g = gym();
		expect(() => saveTask(me, g.taskId, withMetric(form(g.taskId), g.reps, { repeats: false }))).toThrow(/per set/);
		const fresh = gym({ log: false });
		saveTask(me, fresh.taskId, withMetric(form(fresh.taskId), fresh.reps, { repeats: false }));
		expect(form(fresh.taskId).metrics.find((m) => m.id === fresh.reps)!.repeats).toBe(false);
	});

	it('build or break is fixed once the habit has logs', () => {
		const g = gym();
		const f = getHabitForm(me, g.habitId)!;
		expect(() => saveHabit(me, g.habitId, { ...f, direction: 'break' }, today)).toThrow(PastEditError);
		expect(getHabitForm(me, g.habitId)!.direction).toBe('build');
		expect(getHabitForm(me, g.habitId)!.variants).toHaveLength(1);
		// Nothing logged yet: switching is still allowed.
		const fresh = gym({ log: false });
		saveHabit(me, fresh.habitId, { ...getHabitForm(me, fresh.habitId)!, direction: 'break' }, today);
		expect(getHabitForm(me, fresh.habitId)!.direction).toBe('break');
	});
});

describe('removing a field or sub-task with logs archives it', () => {
	it('a logged field is archived: its values stay, it leaves the editor and the Slot targets', () => {
		const g = gym();
		const f = form(g.taskId);
		saveTask(me, g.taskId, { ...f, metrics: f.metrics.filter((m) => m.id !== g.weight) });
		const row = db.select().from(metric).where(eq(metric.id, g.weight)).get()!;
		expect(row.archived).toBe(true);
		expect(valuesOf(g.taskId)[0][g.weight]).toBe(100);
		expect(form(g.taskId).metrics.map((m) => m.id)).toEqual([g.reps]);
		expect(slotRow(g.slot).targets).toEqual({ [g.reps]: 5 });
		// The logged day still knows what it aimed for.
		expect(occRow(g.occ).goals![g.slot].targets![g.weight]).toBe(90);
		// Saving the Task again keeps the archived field.
		saveTask(me, g.taskId, form(g.taskId));
		expect(db.select().from(metric).where(eq(metric.id, g.weight)).get()).toBeTruthy();
	});

	it('a field never logged is deleted', () => {
		const g = gym({ log: false });
		const f = form(g.taskId);
		saveTask(me, g.taskId, { ...f, metrics: f.metrics.filter((m) => m.id !== g.weight) });
		expect(db.select().from(metric).where(eq(metric.id, g.weight)).get()).toBeUndefined();
	});

	it('a ticked step is archived with its ticks; an unticked one is deleted', () => {
		const g = gym();
		saveTask(me, g.taskId, { ...form(g.taskId), parts: [] });
		expect(db.select().from(task).where(eq(task.id, g.sub)).get()!.archived).toBe(true);
		expect(db.select().from(taskPart).where(eq(taskPart.id, g.sub)).get()!.archived).toBe(true);
		expect(valuesOf(g.sub)).toEqual([{ done: true }]);
		expect(form(g.taskId).parts).toEqual([]);
		const fresh = gym({ log: false });
		saveTask(me, fresh.taskId, { ...form(fresh.taskId), parts: [] });
		expect(db.select().from(task).where(eq(task.id, fresh.sub)).get()).toBeUndefined();
		expect(db.select().from(taskPart).where(eq(taskPart.id, fresh.sub)).get()).toBeUndefined();
	});
});

describe('raise by steps', () => {
	it("each target rises by its own field's step: 100 kg + 2.5, 5 reps + 1", () => {
		const g = gym({ log: false });
		const targets = slotRow(g.slot).targets!;
		expect(raise(targets, { after: 3, by: 1, unit: 'steps' }, stepsOf(Object.keys(targets)))).toEqual({ [g.weight]: 102.5, [g.reps]: 6 });
	});

	it('the migration turns an old "amount" progression into one step', () => {
		const g = gym({ log: false });
		db.update(habit).set({ progression: { after: 3, by: 2.5, unit: 'amount' as never } }).where(eq(habit.id, g.habitId)).run();
		const stmt = readFileSync('./drizzle/0008_history_policy.sql', 'utf8').split('--> statement-breakpoint')[1];
		db.run(sql.raw(stmt));
		expect(db.select().from(habit).where(eq(habit.id, g.habitId)).get()!.progression).toEqual({ after: 3, by: 1, unit: 'steps' });
	});
});
