// "Less is better" on a build habit's target: a day at or under the target is done,
// a Minimum sits above it and a Stretch below, and a day with nothing logged stays missed.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { occurrence } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { loadToday, settleAll, userToday } from './today';
import { saveHabit } from './repo/habits';
import { saveTask } from './repo/tasks';
import { plusOne, progressForIds } from './progress';
import { habitForm, taskForm } from '$lib/forms';
import { addDays } from '$lib/engine/dates';
import { progressText } from '$lib/engine/progress';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';

let me: string;
let app: Actor;
let today: string;
const d = (n: number) => addDays(today, n);
const run = (name: string, input: unknown = {}) => runAction(app, name, input) as Record<string, unknown>;
const occOf = (habitId: string, date: string) => db.select().from(occurrence).where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, date))).get()!;

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('lessbetter', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
	app = appActor(me);
});

/** A daily build habit counting cigarettes, up to `target` a day (Minimum and Stretch when given). */
function cigarettes(name: string, target: number, levels?: { min: number; stretch: number }) {
	const metricId = randomUUID();
	const taskId = saveTask(me, null, taskForm.parse({ name: `${name} count`, restTimerEnabled: false, restTimerSeconds: 90, tags: [], metrics: [{ id: metricId, name: 'Cigarettes', type: 'count', repeats: false, better: 'less' }], parts: [] }))!;
	const v = randomUUID();
	const start = d(-6);
	const id = saveHabit(
		me,
		null,
		habitForm.parse({
			name,
			direction: 'build',
			startDate: start,
			variants: [{ id: v, name: 'Main', slots: [{ id: randomUUID(), taskId, fillRule: null, sets: null, targets: { [metricId]: target }, minTargets: levels ? { [metricId]: levels.min } : {}, stretchTargets: levels ? { [metricId]: levels.stretch } : {} }] }],
			schedule: { kind: 'interval', every: 1, start, variantId: v },
			...(levels ? { levels: { enabled: true, minimum: '', target: '', stretch: '' } } : {})
		}),
		today
	)!;
	return { id, task: `${name} count` };
}

describe('a build habit where less is better', () => {
	it('is done at or under the target, missed over it, and missed with nothing logged', () => {
		const h = cigarettes('Smoke less', 5);
		settleAll(me, today);
		for (const [ago, n] of [[-5, 4], [-4, 5], [-3, 6], [-2, 0]] as const) run('log_task', { habit: h.id, task: h.task, date: d(ago), values: { Cigarettes: n } });
		settleAll(me, today);
		expect([-5, -4, -3, -2, -1].map((n) => occOf(h.id, d(n)).status)).toEqual(['done', 'done', 'missed', 'done', 'missed']);
		expect(progressText(progressForIds([occOf(h.id, d(-3)).id]).get(occOf(h.id, d(-3)).id)!)).toBe('6 of at most 5 cigarettes');
	});

	it('with levels: over the target but at or under the Minimum still counts', () => {
		const h = cigarettes('Taper', 5, { min: 7, stretch: 2 });
		settleAll(me, today);
		run('log_task', { habit: h.id, task: h.task, date: d(-3), values: { Cigarettes: 6 } });
		run('log_task', { habit: h.id, task: h.task, date: d(-2), values: { Cigarettes: 9 } });
		settleAll(me, today);
		expect([occOf(h.id, d(-3)).status, occOf(h.id, d(-2)).status]).toEqual(['done', 'missed']);
	});

	it("today stays open while you count with +1, and going over a finished day's most opens it again", () => {
		const h = cigarettes('Count today', 3);
		loadToday(me, today);
		const o = occOf(h.id, today);
		expect(plusOne(o.id)).toMatchObject({ value: 1, done: false });
		expect(occOf(h.id, today).status).toBe('due');
		run('log_done', { habit: h.id });
		expect(occOf(h.id, today).status).toBe('done');
		plusOne(o.id);
		plusOne(o.id);
		expect(plusOne(o.id)).toMatchObject({ value: 4, done: false });
		expect(occOf(h.id, today).status).toBe('due');
	});
});
