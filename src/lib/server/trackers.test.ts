// Trackers: a habit that only keeps what you log, like weight or mood. Nothing it
// logs is done or missed: no misses, no streak, never in the day's count. It can be logged any day,
// its schedule only says when to ask, and a second number the same day adds or replaces per field.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { habit, occurrence } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { loadToday, settleAll, userToday, weekStrip } from './today';
import { getHabitForm } from './repo/habits';
import { addDays } from '$lib/engine/dates';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';
import { EXAMPLES } from './core/setup-guide';
import { dayCount } from '$lib/history/day';

let me: string;
let app: Actor;
let today: string;
const d = (n: number) => addDays(today, n);
type Answer = Record<string, unknown>;
const run = (name: string, input: unknown = {}) => runAction(app, name, input) as Answer;
const setup = (changes: unknown[]) => run('setup', { changes, apply: true });
const named = (name: string) => db.select().from(habit).where(and(eq(habit.accountId, me), eq(habit.name, name))).get()!;
const occs = (habitId: string) => db.select().from(occurrence).where(eq(occurrence.habitId, habitId)).all();

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('trackers', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
	app = appActor(me);
	// The guide's weigh-in, started two weeks ago.
	const weight = EXAMPLES.find((e) => e.goal.startsWith('Keep track of my weight'))!;
	setup((weight.changes as Answer[]).map((c) => (c.op === 'add_habit' ? { ...c, habit: { ...(c.habit as Answer), startDate: d(-14) } } : c)));
});

describe('a tracker', () => {
	it('is saved as a tracker, with nothing to aim for or miss', () => {
		const f = getHabitForm(me, named('Weight').id)!;
		expect(f.scoring).toBe('track');
		expect(f.unlogged).toBe('ignore');
		expect(f.streakRule).toEqual({ kind: 'neverTwice' });
	});

	it('logs any day, even off its schedule (which starts today), and its unlogged days are never missed', () => {
		const h = named('Weight');
		for (const [ago, kg] of [[-10, 83.4], [-8, 83], [-6, 82.9], [-1, 82.4]] as const) run('log_value', { habit: 'Weight', value: kg, date: d(ago) });
		settleAll(me, today);
		const mine = occs(h.id);
		expect(mine.some((o) => o.status === 'missed')).toBe(false);
		expect(mine.filter((o) => o.date < today).map((o) => o.date).sort()).toEqual([d(-10), d(-8), d(-6), d(-1)]);
		// Off its schedule they are marked extra, so switching it back to a habit judges only its due days.
		expect(mine.filter((o) => o.date < today).every((o) => o.extra)).toBe(true);
	});

	it('a second weigh-in the same day replaces the first; mode still overrides it', () => {
		run('log_value', { habit: 'Weight', value: 82.1, date: d(-1) });
		expect(run('log_value', { habit: 'Weight', value: 82, date: d(-1) })).toMatchObject({ value: 82 });
		expect(run('log_value', { habit: 'Weight', value: 0.5, date: d(-1), mode: 'add' })).toMatchObject({ value: 82.5 });
		run('log_value', { habit: 'Weight', value: 82.4, date: d(-1), mode: 'set' });
	});

	it('stands apart on Today with its last value, and never counts toward the day', () => {
		const t = loadToday(me, today);
		const w = t.tracking.find((x) => x.name === 'Weight')!;
		expect(w).toBeTruthy();
		expect(t.build.some((x) => x.name === 'Weight')).toBe(false);
		expect(w.last).toMatch(/^82\.4 kg, yesterday · −0\.\d kg in a week$/);
		expect(w.stats.consistency).toBeNull();
		expect(weekStrip(me, today).every((day) => day.of === 0)).toBe(true);
		const dayLog = occs(named('Weight').id).find((o) => o.date === d(-1))!;
		expect(dayCount([{ ...dayLog, scoring: 'track', direction: 'build' } as never])).toEqual({ done: 0, of: 0 });
	});

	it('says what it is over MCP', () => {
		const h = (run('describe').habits as Answer[]).find((x) => x.name === 'Weight')!;
		expect(h).toMatchObject({ tracker: true, streakRule: null, totals: { logged: 4 } });
		const field = ((run('describe').tasks as Answer[]).find((x) => x.name === 'Weigh-in')!.fields as Answer[])[0];
		expect(field).toMatchObject({ name: 'Weight', sameDay: 'replace' });
		const t = run('today');
		expect((t.build as Answer[]).some((r) => r.habit === 'Weight')).toBe(false);
		expect(t.tracking).toEqual([expect.objectContaining({ habit: 'Weight', loggedToday: false, last: expect.stringMatching(/^82\.4 kg, yesterday/) })]);
		const s = (run('habit_summary', { habits: ['Weight'] }).habits as Answer[])[0];
		expect(s).toMatchObject({ tracker: true, daysLogged: 4, lastLogged: d(-1) });
	});

	it('can’t sit in a group or routine', () => {
		expect(() => setup([{ op: 'add_habit', key: 'am', habit: { name: 'Morning', schedule: { kind: 'interval', every: 1 } } }, { op: 'add_habit', habit: { name: 'Mood', scoring: 'track', parentId: 'am', schedule: { kind: 'follow', on: null } } }])).toThrow(
			/tracker counts nothing/
		);
	});
});

describe('switching between habit and tracker', () => {
	it('a habit becomes a tracker: its misses go, targets, Levels and the streak rule are dropped, what was logged stays', () => {
		setup([
			{ op: 'add_task', key: 'water', task: { name: 'Water', metrics: [{ name: 'Glasses', type: 'count' }] } },
			{
				op: 'add_habit',
				habit: {
					name: 'Drink water',
					startDate: d(-5),
					schedule: { kind: 'interval', every: 1, start: d(-5) },
					streakRule: { kind: 'grace', misses: 1, period: 'week' },
					levels: { enabled: true, minimum: '4', target: '8', stretch: '10' },
					variants: [{ name: 'Day', slots: [{ taskId: 'water', targets: { Glasses: 8 }, minTargets: { Glasses: 4 } }] }]
				}
			}
		]);
		const h = named('Drink water');
		run('log_value', { habit: 'Drink water', value: 3, date: d(-3) });
		run('log_value', { habit: 'Drink water', value: 2, date: d(-3) });
		settleAll(me, today);
		expect(occs(h.id).filter((o) => o.status === 'missed').length).toBeGreaterThan(0);

		setup([{ op: 'edit_habit', habit: 'Drink water', set: { scoring: 'track' } }]);
		settleAll(me, today);
		const f = getHabitForm(me, h.id)!;
		expect(f).toMatchObject({ scoring: 'track', levels: { enabled: false }, streakRule: { kind: 'neverTwice' }, unlogged: 'ignore' });
		expect(f.variants[0].slots[0].targets).toEqual({});
		expect(occs(h.id).some((o) => o.status === 'missed')).toBe(false);
		// Glasses add up during a day (the field's default).
		expect(run('log_value', { habit: 'Drink water', value: 1, date: d(-3) })).toMatchObject({ value: 6 });

		setup([{ op: 'edit_habit', habit: 'Drink water', set: { scoring: 'habit' } }]);
		expect(getHabitForm(me, h.id)!.scoring).toBe('habit');
		expect(loadToday(me, today).build.some((x) => x.name === 'Drink water')).toBe(true);
	});
});
