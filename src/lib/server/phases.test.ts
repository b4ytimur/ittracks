// Phases against a real (in-memory) database: "5 a day with Ramp-up for a week, then 1 a day
// with Maintain". Today, misses, logging a past day and a routine in phases all follow the
// phase each day falls in.
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
import { habitForm, taskForm } from '$lib/forms';
import { addDays } from '$lib/engine/dates';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';

let me: string;
let app: Actor;
let today: string;

const run = (name: string, input: unknown = {}) => runAction(app, name, input) as Record<string, unknown>;
const rowOn = (habitId: string, date: string) =>
	db.select().from(occurrence).where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, date))).get();
const daily = (v: string) => ({ kind: 'interval' as const, every: 1, start: today, variantId: v });

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('phases', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
	app = appActor(me);
});

/** Water: 5 glasses a day with Ramp-up for `first` days from `start`, then 1 a day with Maintain. */
function water(start: string, first: number) {
	const glasses = randomUUID();
	const t = saveTask(me, null, taskForm.parse({ name: `Glasses ${randomUUID().slice(0, 6)}`, restTimerEnabled: false, restTimerSeconds: 90, tags: [], metrics: [{ id: glasses, name: 'Glasses', type: 'count', repeats: false }], parts: [] }))!;
	const ramp = randomUUID();
	const keep = randomUUID();
	const slot = (n: number) => [{ id: randomUUID(), taskId: t, fillRule: null, sets: null, targets: { [glasses]: n } }];
	const id = saveHabit(
		me,
		null,
		habitForm.parse({
			name: `Water ${randomUUID().slice(0, 6)}`,
			direction: 'build',
			startDate: start,
			variants: [
				{ id: ramp, name: 'Ramp-up', slots: slot(5) },
				{ id: keep, name: 'Maintain', slots: slot(1) }
			],
			schedule: {
				kind: 'phases',
				start,
				phases: [
					{ length: first, unit: 'day', schedule: daily(ramp) },
					{ length: null, unit: 'week', schedule: daily(keep) }
				]
			}
		}),
		today
	)!;
	return { id, ramp, keep, glasses };
}

describe('a habit in phases', () => {
	it('is due today with the Variant of the phase today falls in', () => {
		const early = water(today, 7);
		const later = water(addDays(today, -7), 7);
		const t = loadToday(me, today);
		expect(t.build.find((x) => x.habitId === early.id)).toMatchObject({ occurrence: { variantName: 'Ramp-up' }, progress: { kind: 'amount', target: 5 } });
		expect(t.build.find((x) => x.habitId === later.id)).toMatchObject({ occurrence: { variantName: 'Maintain' }, progress: { kind: 'amount', target: 1 } });
	});

	it('misses each unlogged day with the Variant of its phase', () => {
		const w = water(addDays(today, -4), 2);
		settleAll(me, today);
		expect([4, 3, 2, 1].map((ago) => rowOn(w.id, addDays(today, -ago))).map((o) => [o?.status, o?.variantId])).toEqual([
			['missed', w.ramp],
			['missed', w.ramp],
			['missed', w.keep],
			['missed', w.keep]
		]);
	});

	it('tells an AI each phase\'s dates and which one is now', () => {
		const w = water(addDays(today, -2), 7);
		const d = run('describe') as { habits: { id: string; schedule: string; phases?: { from: string; to: string | null; variants: string[]; current: boolean }[] }[] };
		const h = d.habits.find((x) => x.id === w.id)!;
		expect(h.schedule).toBe('Every day (Ramp-up) for 7 days, then every day (Maintain)');
		expect(h.phases).toEqual([
			{ from: addDays(today, -2), to: addDays(today, 4), schedule: 'Every day', variants: ['Ramp-up'], current: true },
			{ from: addDays(today, 5), to: null, schedule: 'Every day', variants: ['Maintain'], current: false }
		]);
	});

	it('logs a past day with the targets of its phase', () => {
		const w = water(addDays(today, -3), 2);
		const d = addDays(today, -3);
		run('log_done', { habit: w.id, date: d });
		expect(rowOn(w.id, d)).toMatchObject({ status: 'done', variantId: w.ramp });
	});
});

describe('a routine in phases', () => {
	it('brings in the habits that follow one phase\'s Variant only in that phase', () => {
		const base = randomUUID();
		const build = randomUUID();
		const id = saveHabit(
			me,
			null,
			habitForm.parse({
				name: 'Program',
				direction: 'build',
				startDate: addDays(today, -7),
				variants: [
					{ id: base, name: 'Base', slots: [] },
					{ id: build, name: 'Build', slots: [] }
				],
				schedule: {
					kind: 'phases',
					start: addDays(today, -7),
					phases: [
						{ length: 1, unit: 'week', schedule: daily(base) },
						{ length: null, unit: 'week', schedule: daily(build) }
					]
				}
			}),
			today
		)!;
		const kid = (name: string, on: string) => {
			const v = randomUUID();
			return saveHabit(
				me,
				null,
				habitForm.parse({ name, direction: 'build', startDate: addDays(today, -7), variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'follow', variantId: v, on: [on] }, parentId: id }),
				today
			)!;
		};
		const easy = kid('Walk', base);
		const hard = kid('Run', build);
		const ids = loadToday(me, today).build.map((x) => x.habitId);
		expect(ids).toContain(hard);
		expect(ids).not.toContain(easy);
	});
});
