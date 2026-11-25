// What Today and the log screen change without logging, from outside the app: tomorrow's prep, a
// rotation started early, a day's Task swapped or picked again, and Today's raise answered through
// setup. Against a real (in-memory) database.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { event, habit, occurrence, slot, task, variant } from '../db/schema';
import { createAccount } from '../auth';
import { saveSettings } from '../settings';
import { addDays } from '$lib/engine/dates';
import { appActor, ActionError, type Actor } from './actor';
import { runAction } from './actions';
import { todayFor } from './log';

let me: string;
let app: Actor;
let today: string;

type Answer = Record<string, any>;
const run = (name: string, input: unknown) => runAction(app, name, input) as Answer;
const setup = (changes: unknown[], more: Record<string, unknown> = {}) => run('setup', { changes, ...more });
const habitNamed = (name: string) => db.select().from(habit).where(and(eq(habit.accountId, me), eq(habit.name, name))).get()!;
const targetsOf = (name: string) => {
	const v = db.select().from(variant).where(eq(variant.habitId, habitNamed(name).id)).get()!;
	return db.select().from(slot).where(eq(slot.variantId, v.id)).all().find((s) => s.taskId)!.targets;
};
const fails = (fn: () => unknown, code: ActionError['code'], text?: RegExp) => {
	try {
		fn();
	} catch (e) {
		expect(e).toBeInstanceOf(ActionError);
		expect((e as ActionError).code).toBe(code);
		if (text) expect((e as ActionError).message).toMatch(text);
		return;
	}
	throw new Error('expected a failure');
};
const reps = (name: string) => ({ op: 'add_task', task: { name, metrics: [{ name: 'Reps', type: 'count' }] } });

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('plan-tester', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	app = appActor(me);
	today = todayFor(app);
	const yesterday = addDays(today, -1);
	setup(
		[
			reps('Push-ups'),
			reps('Squats'),
			reps('Lunges'),
			reps('Plank'),
			{
				op: 'add_habit',
				habit: {
					name: 'Workout',
					startDate: yesterday,
					schedule: { kind: 'interval', every: 1 },
					prep: ['Fill water bottle', 'Lay out mat'],
					progression: { after: 2, by: 1, unit: 'steps' },
					variants: [{ name: 'Day', slots: [{ taskId: 'Push-ups', targets: { Reps: 10 } }, { taskId: null, fillRule: {} }] }]
				}
			},
			{
				op: 'add_habit',
				habit: {
					name: 'Lift',
					startDate: yesterday,
					schedule: { kind: 'rotation', step: 'variant', order: [{ variantId: 'A', restDays: 1 }, { variantId: 'B', restDays: 1 }], onMiss: 'wait', weekdays: [] },
					variants: [{ name: 'A' }, { name: 'B' }]
				}
			}
		],
		{ apply: true }
	);
	run('log_done', { habit: 'Lift', date: 'yesterday' });
});

describe('log_plan', () => {
	it('ticks and unticks a step of tomorrow\'s prep, as Today does', () => {
		const prep = () => run('today', {}).prep.find((p: Answer) => p.habit === 'Workout');
		expect(prep()).toMatchObject({ date: addDays(today, 1), steps: [{ item: 'Fill water bottle', done: false }, { item: 'Lay out mat', done: false }] });
		expect(run('log_plan', { habit: 'workout', do: 'prep', item: 'lay out mat' })).toEqual({ habit: 'Workout', date: addDays(today, 1), item: 'Lay out mat', done: true });
		expect(prep().steps[1]).toEqual({ item: 'Lay out mat', done: true });
		run('log_plan', { habit: 'Workout', do: 'prep', item: 'Lay out mat', done: false });
		expect(prep().steps[1].done).toBe(false);
		fails(() => run('log_plan', { habit: 'Workout', do: 'prep', item: 'Charge watch' }), 'not_found', /Its steps: Fill water bottle, Lay out mat/);
		fails(() => run('log_plan', { habit: 'Lift', do: 'prep', item: 'Chalk' }), 'invalid', /no prep list/);
	});

	it('starts a resting rotation\'s next Variant today', () => {
		const resting = run('today', {}).resting.find((r: Answer) => r.habit === 'Lift');
		expect(resting).toMatchObject({ startEarly: 'B' });
		const r = run('log_plan', { habit: 'Lift', do: 'early' });
		expect(r).toMatchObject({ habit: 'Lift', date: today, status: 'due', variant: 'B' });
		// Not an extra session: the rotation moves on, as Start early does.
		expect(db.select().from(occurrence).where(eq(occurrence.id, r.occurrenceId)).get()!.extra).toBe(false);
		fails(() => run('log_plan', { habit: 'Lift', do: 'early' }), 'invalid', /already has today's log/);
		fails(() => run('log_plan', { habit: 'Workout', do: 'early' }), 'invalid', /already has today's log/);
	});

	it('swaps a slot\'s Task for the day, or picks another one by the slot\'s rule', () => {
		const s = run('log_plan', { habit: 'Workout', do: 'swap', slot: 'push-ups', task: 'plank' });
		expect(s).toMatchObject({ habit: 'Workout', date: today, slot: 1, was: 'Push-ups', now: 'Plank' });
		const before = run('log_plan', { habit: 'Workout', do: 'reroll', slot: '2' });
		expect(before.slot).toBe(2);
		expect(['Squats', 'Lunges']).toContain(before.now);
		// The day already holds Plank and the Push-ups slot's own Task, so neither comes back.
		const again = run('log_plan', { habit: 'Workout', do: 'reroll', slot: '2' });
		expect(again.was).toBe(before.now);
		expect(['Squats', 'Lunges'].filter((t) => t !== before.now)).toEqual([again.now]);
		fails(() => run('log_plan', { habit: 'Workout', do: 'reroll', slot: 'Plank' }), 'invalid', /has its own Task: swap it instead/);
		fails(() => run('log_plan', { habit: 'Workout', do: 'swap', slot: '3', task: 'Squats' }), 'not_found', /1\. Plank; 2\./);
		fails(() => run('log_plan', { habit: 'Workout', do: 'swap', slot: '1', task: 'Burpees' }), 'not_found', /No Task called “Burpees”/);
		// Only that day changes: the habit keeps Push-ups.
		const v = db.select().from(variant).where(eq(variant.habitId, habitNamed('Workout').id)).get()!;
		const own = db.select().from(slot).where(eq(slot.variantId, v.id)).all().map((x) => x.taskId);
		expect(own).toEqual([db.select().from(task).where(and(eq(task.accountId, me), eq(task.name, 'Push-ups'))).get()!.id, null]);
		const types = db.select().from(event).where(and(eq(event.accountId, me), eq(event.type, 'plan.changed'))).all().map((e) => (e.data as Answer).what);
		expect(types).toEqual(['prep', 'prep', 'early', 'swap', 'reroll', 'reroll']);
	});
});

describe('setup: progression', () => {
	const reps = () => Object.values(targetsOf('Workout') ?? {})[0];

	it('says when Today suggests a raise, and raises with a preview and undo', () => {
		expect(run('today', {}).raise).toEqual([]);
		run('log_done', { habit: 'Workout', date: 'yesterday', how: 'targets' });
		run('log_done', { habit: 'Workout', how: 'targets' });
		expect(run('today', {}).raise).toEqual([expect.objectContaining({ habit: 'Workout', hits: 2, changes: ['Push-ups: Reps 10→11'] })]);

		const p = setup([{ op: 'progression', habit: 'Workout', answer: 'raise' }]);
		expect(p.summary).toEqual(['Raise the targets of “Workout” by 1 step: Push-ups: Reps 10→11']);
		expect(p.changes[0].warnings).toEqual([]);
		expect(reps()).toBe(10);
		const a = setup([{ op: 'progression', habit: 'Workout', answer: 'raise' }], { apply: true, check: p.check });
		expect(reps()).toBe(11);
		expect(habitNamed('Workout').progressionFrom).toBe(today);
		expect(run('today', {}).raise).toEqual([]);
		run('setup_undo', { undo: a.undo });
		expect(reps()).toBe(10);
		expect(habitNamed('Workout').progressionFrom).toBeNull();
	});

	it('not yet keeps the targets and counts again from today', () => {
		const a = setup([{ op: 'progression', habit: 'Workout', answer: 'not_yet' }], { apply: true });
		expect(a.summary).toEqual(['Keep the targets of “Workout”; the count toward the next raise starts again today']);
		expect(reps()).toBe(10);
		expect(habitNamed('Workout').progressionFrom).toBe(today);
		// Not suggested now: a raise still works, and says so.
		const p = setup([{ op: 'progression', habit: 'Workout', answer: 'raise' }]);
		expect(p.changes[0].warnings).toEqual([expect.stringMatching(/doesn't suggest a raise for “Workout” yet: it waits for 2 logs/)]);
		fails(() => setup([{ op: 'progression', habit: 'Lift', answer: 'raise' }]), 'invalid', /has no progression/);
	});
});
