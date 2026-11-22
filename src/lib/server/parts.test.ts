// Tasks inside Tasks against a real (in-memory) database: parts are saved and checked for
// loops, every value is logged at its place (rounds included), one-tap logs and "Same as last
// time" fill every place, removed parts keep their logs, and export/import keeps the places.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from './db';
import { entry, habit, occurrence, task, taskPart } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { loadToday, quickDone, sameAsLast, userToday } from './today';
import { saveHabit } from './repo/habits';
import { checkTaskLinks, getTaskForm, saveTask } from './repo/tasks';
import { habitForm, taskForm, type PartForm } from '$lib/forms';
import { addDays } from '$lib/engine/dates';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';
import { positionsOf } from './positions';
import { progressForIds } from './progress';
import { progressText } from '$lib/engine/progress';
import { loadDataset } from './stats';
import { prepare } from '$lib/stats/engine';

let me: string;
let app: Actor;
let today: string;

const run = (name: string, input: unknown = {}) => runAction(app, name, input) as Record<string, unknown>;

/** A Library Task with one field: per set (reps) or once (minutes); or none (a Yes or no). */
function libTask(name: string, field: { name: string; type: 'count' | 'duration'; repeats: boolean } | null, parts: PartForm[] = []) {
	const metricId = randomUUID();
	const id = saveTask(
		me,
		null,
		taskForm.parse({
			name,
			restTimerEnabled: false,
			restTimerSeconds: 90,
			tags: [],
			metrics: field ? [{ id: metricId, name: field.name, type: field.type, repeats: field.repeats }] : [],
			parts
		})
	)!;
	return { id, metricId };
}
const step = (name: string): PartForm => ({ kind: 'step', id: randomUUID(), name });
const inside = (taskId: string, extra: Partial<Extract<PartForm, { kind: 'task' }>> = {}): PartForm => ({
	kind: 'task',
	id: randomUUID(),
	taskId,
	sets: null,
	targets: {},
	minTargets: {},
	stretchTargets: {},
	...extra
});

/** A daily habit with one Slot holding `taskId`, `sets` sets (rounds for a Task with parts). */
function dailyWith(name: string, taskId: string, sets: number | null = null, ago = 3): string {
	const v = randomUUID();
	const start = addDays(today, -ago);
	return saveHabit(
		me,
		null,
		habitForm.parse({
			name,
			direction: 'build',
			startDate: start,
			variants: [{ id: v, name: 'Main', slots: [{ id: randomUUID(), taskId, fillRule: null, sets }] }],
			schedule: { kind: 'interval', every: 1, start, variantId: v }
		}),
		today
	)!;
}
const occOn = (habitId: string, date: string) =>
	db.select().from(occurrence).where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, date))).get()!;
const entriesOf = (occId: string) => db.select().from(entry).where(eq(entry.occurrenceId, occId)).orderBy(asc(entry.sortOrder)).all();

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('parts', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
	app = appActor(me);
});

describe('saving parts', () => {
	it('keeps steps and Library Tasks in order, and refuses a Task inside itself', () => {
		const push = libTask('Push-ups', { name: 'Reps', type: 'count', repeats: false });
		const circuit = libTask('Circuit', null, [step('Warm up'), inside(push.id, { targets: { [push.metricId]: 10 } })]);
		const f = getTaskForm(me, circuit.id)!;
		expect(f.parts.map((p) => p.kind)).toEqual(['step', 'task']);
		expect(f.parts[1]).toMatchObject({ taskId: push.id, targets: { [push.metricId]: 10 } });
		// The step is private: it never shows in the Library.
		const stepRow = db.select().from(task).where(eq(task.id, f.parts[0].id)).get()!;
		expect(stepRow.parentTaskId).toBe(circuit.id);

		expect(checkTaskLinks(me, circuit.id, { parts: [inside(circuit.id)] })).toMatch(/inside itself/);
		expect(checkTaskLinks(me, push.id, { parts: [inside(circuit.id)] })).toMatch(/already has this Task inside it/);
		expect(checkTaskLinks(me, push.id, { parts: [inside(stepRow.id)] })).toMatch(/Library/);
	});
});

describe('logging a Circuit', () => {
	it('logs each round at its own place, counts every step, and fills every place on one tap', () => {
		const push = libTask('Push-ups 2', { name: 'Reps', type: 'count', repeats: false });
		const squat = libTask('Squats 2', { name: 'Reps', type: 'count', repeats: false });
		const circuit = libTask('Circuit 2', null, [inside(push.id, { targets: { [push.metricId]: 10 } }), inside(squat.id, { targets: { [squat.metricId]: 15 } }), step('Stretch')]);
		const h = dailyWith('Circuit day', circuit.id, 2);
		run('log_task', { habit: h, task: 'Circuit 2 › Push-ups 2', values: { Reps: 12 } });
		run('log_task', { habit: h, task: 'Circuit 2 > Push-ups 2', round: 2, values: { Reps: 9 } });
		run('log_task', { habit: h, task: 'Circuit 2', ticks: ['Stretch'] });
		const occ = occOn(h, today);
		const es = entriesOf(occ.id);
		const paths = es.map((e) => e.path!);
		expect(paths.filter((p) => p.endsWith(`/${getTaskForm(me, circuit.id)!.parts[0].id}`))).toHaveLength(2);
		expect(new Set(paths).size).toBe(3);
		// 2 rounds of 3 steps; 3 are done.
		expect(progressText(progressForIds([occ.id]).get(occ.id)!)).toBe('3 of 6 steps');
		expect(occ.status).toBe('due');

		quickDone(occ.id, null);
		const after = entriesOf(occ.id);
		expect(after.filter((e) => e.taskId === push.id).map((e) => e.values[push.metricId])).toEqual([10, 10]);
		expect(after.filter((e) => e.values.done === true)).toHaveLength(2);
		expect(occOn(h, today).status).toBe('done');
		expect(progressText(progressForIds([occ.id]).get(occ.id)!)).toBe('6 of 6 steps');
	});

	it('"Same as last time" copies each place from the last log, round by round', () => {
		const run1 = libTask('Run 3', { name: 'Minutes', type: 'duration', repeats: false });
		const circuit = libTask('Intervals 3', null, [inside(run1.id)]);
		const h = dailyWith('Intervals', circuit.id, 2);
		const y = addDays(today, -1);
		run('log_task', { habit: h, date: y, task: 'Intervals 3 › Run 3', round: 1, values: { Minutes: 4 } });
		run('log_task', { habit: h, date: y, task: 'Intervals 3 › Run 3', round: 2, values: { Minutes: 6 }, finish: 'yes' });
		loadToday(me, today);
		const occ = occOn(h, today);
		expect(sameAsLast(occ.id)).toBe('done');
		const vals = entriesOf(occ.id).map((e) => [e.path!.split('/')[0].split('#')[1], e.values[run1.metricId]]);
		expect(vals).toEqual([
			['1', 4],
			['2', 6]
		]);
	});

	it('reads ticks logged before paths, and keeps a removed part showing in logs that have it', () => {
		const s1 = step('Sink');
		const s2 = step('Mirror');
		const clean = libTask('Clean 4', null, [s1, s2]);
		const h = dailyWith('Bathroom', clean.id);
		loadToday(me, today);
		const occ = occOn(h, today);
		// An old tick: an Entry of the step, no path.
		db.insert(entry).values({ id: randomUUID(), occurrenceId: occ.id, taskId: s1.id, values: { done: true }, sortOrder: 0 }).run();
		expect(progressText(progressForIds([occ.id]).get(occ.id)!)).toBe('1 of 2 steps');

		saveTask(me, clean.id, { ...getTaskForm(me, clean.id)!, parts: [s2] });
		expect(db.select().from(taskPart).where(eq(taskPart.id, s1.id)).get()!.archived).toBe(true);
		const kept = positionsOf(occ, { keep: new Set([s1.id]) });
		expect(kept.map((p) => p.taskId)).toContain(s1.id);
		expect(positionsOf(occ).map((p) => p.taskId)).not.toContain(s1.id);
	});
});

describe('Stats and export', () => {
	it('gives a Task inside another its own logs, and its parent a count of parts done', () => {
		const lift = libTask('Lift 5', { name: 'Reps', type: 'count', repeats: true });
		const block = libTask('Block 5', null, [inside(lift.id, { sets: 3 }), step('Chalk')]);
		const h = dailyWith('Strength', block.id);
		run('log_task', { habit: h, task: 'Block 5 › Lift 5', sets: [{ Reps: 5 }, { Reps: 5 }] });
		const P = prepare(loadDataset(me));
		const liftLogs = (P.logsByTask.get(lift.id) ?? []).filter((l) => l.habit.id === h);
		expect(liftLogs).toHaveLength(1);
		expect(liftLogs[0].sets).toHaveLength(2);
		expect(liftLogs[0].slot?.sets).toBe(3);
		const blockLog = (P.logsByTask.get(block.id) ?? []).find((l) => l.habit.id === h)!;
		expect([blockLog.subsDone, blockLog.subsTotal]).toEqual([1, 2]);
	});

	it('restores parts and paths into another account with new ids, and turns old steps into parts', async () => {
		const { exportJson, importReplace } = await import('./core/export');
		const file = JSON.parse(JSON.stringify(exportJson(app)));
		const other = await createAccount('parts-copy', 'another long password');
		const r = importReplace(appActor(other), file);
		expect(r.renumbered).toBe(true);
		const block = db.select().from(task).where(and(eq(task.accountId, other), eq(task.name, 'Block 5'))).get()!;
		const lift = db.select().from(task).where(and(eq(task.accountId, other), eq(task.name, 'Lift 5'))).get()!;
		const part = db.select().from(taskPart).where(eq(taskPart.taskId, block.id)).all().find((p) => p.childTaskId === lift.id)!;
		const h = db.select().from(habit).where(and(eq(habit.accountId, other), eq(habit.name, 'Strength'))).get()!;
		const occ = occOn(h.id, today);
		const es = entriesOf(occ.id).filter((e) => e.taskId === lift.id);
		expect(es).toHaveLength(2);
		expect(es[0].path!.endsWith(`/${part.id}`)).toBe(true);
		expect(positionsOf(occ).some((p) => p.path === es[0].path)).toBe(true);

		// An export from before parts: steps are Tasks with a parent, and no part rows.
		delete file.tables.taskPart;
		const third = await createAccount('parts-old', 'yet another long password');
		importReplace(appActor(third), file);
		const clean = db.select().from(task).where(and(eq(task.accountId, third), eq(task.name, 'Clean 4'))).get()!;
		expect(db.select().from(taskPart).where(eq(taskPart.taskId, clean.id)).all().length).toBeGreaterThan(0);
	});
});
