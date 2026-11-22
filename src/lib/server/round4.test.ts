// The swarm round 4 bugs, each as its tester hit it, against a real (in-memory) database:
// Started on for a habit made today, routines' misses, moves into and out of groups and
// routines, Slot edits, Stats in rounds, and partial logs from keys and links.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from './db';
import { entry, habit, occurrence } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { loadToday, restorePartialDays, settleAll, userToday } from './today';
import { getHabitForm, saveHabit } from './repo/habits';
import { saveTask, getTaskForm } from './repo/tasks';
import { archiveHabit, moveHabit, unarchiveHabit } from './habit-actions';
import { habitForm, taskForm, type HabitForm, type PartForm } from '$lib/forms';
import { addDays } from '$lib/engine/dates';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';
import { positionsOf } from './positions';
import { progressForIds } from './progress';
import { progressText } from '$lib/engine/progress';
import { ctxFor, getStats, loadDataset } from './stats';
import { computeCard, prepare, targetMetOfOcc } from '$lib/stats/engine';
import { makeCard } from '$lib/stats/model';

let me: string;
let app: Actor;
let today: string;
const d = (n: number) => addDays(today, n);

const run = (name: string, input: unknown = {}) => runAction(app, name, input) as Record<string, unknown>;
const rowOn = (habitId: string, date: string) =>
	db.select().from(occurrence).where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, date))).get();
const statusOn = (habitId: string, date: string) => rowOn(habitId, date)?.status ?? null;
const rows = (habitId: string) => db.select().from(occurrence).where(eq(occurrence.habitId, habitId)).orderBy(asc(occurrence.date)).all();
const missed = (habitId: string) => rows(habitId).filter((r) => r.status === 'missed').map((r) => r.date);
const save = (f: unknown) => saveHabit(me, null, habitForm.parse(f), today)!;
const edit = (id: string, patch: Partial<HabitForm>, applies: 'today' | 'past' = 'today') =>
	saveHabit(me, id, { ...getHabitForm(me, id)!, ...patch }, today, { scheduleApplies: applies });
const habitRow = (id: string) => db.select().from(habit).where(eq(habit.id, id)).get()!;

/** A plain daily habit (a Yes or no), started `ago` days back, inside `parentId` when given. */
function daily(name: string, ago: number, parentId: string | null = null) {
	const v = randomUUID();
	const start = d(-ago);
	return save({ name, direction: 'build', startDate: start, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'interval', every: 1, start, variantId: v }, parentId });
}
const group = (name: string, ago: number) =>
	save({ name, direction: 'build', startDate: d(-ago), variants: [], schedule: { kind: 'group', target: null, minimum: null } });
/** A habit inside a routine that follows it, on some of its Variants when `on` is set. */
function follower(name: string, parentId: string, ago: number, on: string[] | null = null) {
	const v = randomUUID();
	return save({ name, direction: 'build', startDate: d(-ago), variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'follow', variantId: v, on }, parentId });
}

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('round4', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
	app = appActor(me);
});

describe('Started on for a habit made today (P0 1)', () => {
	it('backfills an every-day habit from the Gallery: past days are due, and unlogged ones missed', () => {
		const v = randomUUID();
		const id = save({ name: 'Drink water', direction: 'build', startDate: today, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'interval', every: 1, start: today, variantId: v } });
		// The editor moves the schedule's start with Started on, and sends "from today on".
		edit(id, { startDate: d(-5), schedule: { kind: 'interval', every: 1, start: d(-5), variantId: v } });
		expect(habitRow(id).earlierSchedules).toBeNull();
		run('log_done', { habit: id, date: d(-5) });
		expect(rowOn(id, d(-5))).toMatchObject({ status: 'done', extra: false });
		settleAll(me, today);
		expect(missed(id)).toEqual([d(-4), d(-3), d(-2), d(-1)]);
	});

	it('keeps a rotation\'s Variants on the days the new start gives them', () => {
		const a = randomUUID();
		const b = randomUUID();
		const rot = (start: string) => ({ kind: 'rotation' as const, step: 'variant' as const, order: [{ variantId: a, restDays: 0 }, { variantId: b, restDays: 0 }], onMiss: 'skip' as const, weekdays: [], start });
		const id = save({ name: 'Stretching', direction: 'build', startDate: today, variants: [{ id: a, name: 'A', slots: [] }, { id: b, name: 'B', slots: [] }], schedule: rot(today) });
		edit(id, { startDate: d(-4), schedule: rot(d(-4)) });
		expect(habitRow(id).earlierSchedules).toBeNull();
		settleAll(me, today);
		expect(rows(id).filter((r) => r.date < today).map((r) => [r.date, r.variantId === a ? 'A' : 'B'])).toEqual([
			[d(-4), 'A'],
			[d(-3), 'B'],
			[d(-2), 'A'],
			[d(-1), 'B']
		]);
	});

	it('treats a start moved back with Started on as the same plan, also on a habit with a past', () => {
		const v = randomUUID();
		const id = save({ name: 'Walk', direction: 'build', startDate: d(-2), variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'interval', every: 1, start: d(-2), variantId: v } });
		settleAll(me, today);
		edit(id, { startDate: d(-6), schedule: { kind: 'interval', every: 1, start: d(-6), variantId: v } });
		expect(habitRow(id).earlierSchedules).toBeNull();
		settleAll(me, today);
		expect(missed(id)).toEqual([d(-6), d(-5), d(-4), d(-3), d(-2), d(-1)]);
	});

	it('moves phases along with Started on for a phased habit made today', () => {
		const ramp = randomUUID();
		const keep = randomUUID();
		const phased = (start: string) => ({
			kind: 'phases' as const,
			start,
			phases: [
				{ length: 3, unit: 'day' as const, schedule: { kind: 'interval' as const, every: 1, start, variantId: ramp } },
				{ length: null, unit: 'day' as const, schedule: { kind: 'interval' as const, every: 1, start, variantId: keep } }
			]
		});
		const id = save({ name: 'Ramp up', direction: 'build', startDate: today, variants: [{ id: ramp, name: 'Ramp', slots: [] }, { id: keep, name: 'Keep', slots: [] }], schedule: phased(today) });
		edit(id, { startDate: d(-5), schedule: phased(d(-5)) });
		expect(habitRow(id).earlierSchedules).toBeNull();
		settleAll(me, today);
		expect(rows(id).filter((r) => r.date < today).map((r) => (r.variantId === ramp ? 'Ramp' : 'Keep'))).toEqual(['Ramp', 'Ramp', 'Ramp', 'Keep', 'Keep']);
	});

	it('still keeps the old plan for the past when a habit with a past changes its schedule from today on', () => {
		const v = randomUUID();
		const id = daily('Floss', 4);
		const f = getHabitForm(me, id)!;
		edit(id, { schedule: { kind: 'interval', every: 2, start: today, variantId: f.variants[0].id } });
		expect(habitRow(id).earlierSchedules).toEqual([{ until: d(-1), schedule: expect.objectContaining({ every: 1 }) }]);
		void v;
	});
});

describe('partial logs from a key or a quick-log link (P0 8)', () => {
	/** A habit with one number to reach: `target` glasses a day, started `ago` days back. */
	function glasses(name: string, target: number, ago: number, opts: { minimumCounts?: boolean; required?: boolean } = {}) {
		const m = randomUUID();
		const quality = randomUUID();
		const t = saveTask(
			me,
			null,
			taskForm.parse({
				name: `${name} task`,
				restTimerEnabled: false,
				restTimerSeconds: 90,
				tags: [],
				metrics: [
					{ id: m, name: 'Glasses', type: 'count', repeats: false, required: !!opts.required },
					{ id: quality, name: 'Quality', type: 'count', repeats: false }
				],
				parts: []
			})
		)!;
		const v = randomUUID();
		const start = d(-ago);
		return save({
			name,
			direction: 'build',
			startDate: start,
			minimumCounts: opts.minimumCounts ?? true,
			variants: [{ id: v, name: 'Main', slots: [{ id: randomUUID(), taskId: t, fillRule: null, sets: null, targets: { [m]: target } }] }],
			schedule: { kind: 'interval', every: 1, start, variantId: v }
		});
	}

	it('counts a past day once anything is logged, as the app does, whichever way the value came', () => {
		const id = glasses('Hydrate', 8, 5);
		settleAll(me, today);
		expect(statusOn(id, d(-2))).toBe('missed');
		const r = run('log_value', { habit: id, date: d(-2), value: 7, field: 'Glasses', mode: 'set' });
		expect(r).toMatchObject({ status: 'done', progress: '7 of 8 glasses' });
		// A day not opened before (still unsettled when logged) the same way.
		expect(run('log_value', { habit: id, date: d(-1), value: 2, field: 'Glasses' })).toMatchObject({ status: 'done' });
	});

	it('leaves it missed when only the full target counts', () => {
		const id = glasses('Strict water', 8, 3, { minimumCounts: false });
		settleAll(me, today);
		expect(run('log_value', { habit: id, date: d(-1), value: 7, field: 'Glasses', mode: 'set' })).toMatchObject({ status: 'missed' });
		expect(run('log_value', { habit: id, date: d(-1), value: 8, field: 'Glasses', mode: 'set' })).toMatchObject({ status: 'done' });
	});

	it('keeps a log open while a required field is empty', () => {
		const id = glasses('Sleep log', 1, 1, { required: true });
		expect(run('log_value', { habit: id, value: 4, field: 'Quality' })).toMatchObject({ status: 'due' });
		expect(run('log_value', { habit: id, value: 1, field: 'Glasses' })).toMatchObject({ status: 'done' });
	});

	it('puts back days the old rule left missed with values in them, once', () => {
		const id = glasses('Old API days', 8, 4);
		settleAll(me, today);
		const occ = rowOn(id, d(-3))!;
		const m = getTaskForm(me, positionsOf(occ)[0].taskId)!.metrics[0].id;
		db.insert(entry).values({ id: randomUUID(), occurrenceId: occ.id, taskId: positionsOf(occ)[0].taskId, path: positionsOf(occ)[0].path, values: { [m]: 5, _summary: true }, sortOrder: 0 }).run();
		expect(restorePartialDays()).toBeGreaterThanOrEqual(1);
		expect(statusOn(id, d(-3))).toBe('done');
	});
});

describe('Stats in rounds (P0 6)', () => {
	it('reads every round of a Task inside a Circuit, not only the last one', () => {
		const rep = randomUUID();
		const fast = saveTask(me, null, taskForm.parse({ name: '400 m fast', restTimerEnabled: false, restTimerSeconds: 90, tags: [], metrics: [{ id: rep, name: 'Rep time', type: 'duration', unit: 's', repeats: false }], parts: [] }))!;
		const part: PartForm = { kind: 'task', id: randomUUID(), taskId: fast, sets: null, targets: {}, minTargets: {}, stretchTargets: {} };
		const intervals = saveTask(me, null, taskForm.parse({ name: 'Intervals 3×400', restTimerEnabled: false, restTimerSeconds: 90, tags: [], metrics: [], parts: [part] }))!;
		const v = randomUUID();
		const id = save({ name: 'Quality run', direction: 'build', startDate: d(-3), variants: [{ id: v, name: 'Main', slots: [{ id: randomUUID(), taskId: intervals, fillRule: null, sets: 3 }] }], schedule: { kind: 'interval', every: 1, start: d(-3), variantId: v } });
		[112, 110, 108].forEach((s, i) => run('log_task', { habit: id, date: d(-1), task: 'Intervals 3×400 › 400 m fast', round: i + 1, values: { 'Rep time': s } }));
		const P = prepare(loadDataset(me));
		const log = P.logsByTask.get(fast)!.find((l) => l.habit.id === id)!;
		expect(log.rounds.map((r) => r[rep])).toEqual([112, 110, 108]);
		const avg = computeCard(makeCard({ what: { source: 'field', metrics: [rep] }, perLog: 'value', overTime: 'avg' }), P, ctxFor(today, getStats(me)));
		// Durations show in minutes.
		expect(avg.total).toBeCloseTo(110 / 60, 2);
		const best = computeCard(makeCard({ what: { source: 'field', metrics: [rep] }, perLog: 'value', overTime: 'min' }), P, ctxFor(today, getStats(me)));
		expect(best.total).toBeCloseTo(108 / 60, 2);
	});
});

describe('changing a Variant\'s Slots (P0 4)', () => {
	it('keeps past sessions judged and shown by the Slots they had', () => {
		const reps = randomUUID();
		const bench = saveTask(me, null, taskForm.parse({ name: 'Close-grip bench', restTimerEnabled: false, restTimerSeconds: 90, tags: [], metrics: [{ id: reps, name: 'Reps', type: 'count', repeats: true }], parts: [] }))!;
		const curl = saveTask(me, null, taskForm.parse({ name: 'Arm superset', restTimerEnabled: false, restTimerSeconds: 90, tags: [], metrics: [], parts: [{ kind: 'step', id: randomUUID(), name: 'Curl' }, { kind: 'step', id: randomUUID(), name: 'Pushdown' }] }))!;
		const dipReps = randomUUID();
		const dips = saveTask(me, null, taskForm.parse({ name: 'Dips', restTimerEnabled: false, restTimerSeconds: 90, tags: [], metrics: [{ id: dipReps, name: 'Reps', type: 'count', repeats: true }], parts: [] }))!;
		const v = randomUUID();
		const id = save({ name: 'Upper A', direction: 'build', startDate: d(-5), variants: [{ id: v, name: 'Upper A', slots: [{ id: randomUUID(), taskId: bench, fillRule: null, sets: 2, targets: { [reps]: 8 } }, { id: randomUUID(), taskId: dips, fillRule: null, sets: 1, targets: { [dipReps]: 10 } }] }], schedule: { kind: 'interval', every: 1, start: d(-5), variantId: v } });
		run('log_task', { habit: id, date: d(-3), task: 'Close-grip bench', sets: [{ Reps: 8 }, { Reps: 8 }] });
		run('log_task', { habit: id, date: d(-3), task: 'Dips', sets: [{ Reps: 10 }], finish: 'yes' });
		const occ = rowOn(id, d(-3))!;
		const before = progressText(progressForIds([occ.id]).get(occ.id)!);
		expect(before).toBe('2 of 2 steps');
		expect(statusOn(id, d(-3))).toBe('done');

		const f = getHabitForm(me, id)!;
		edit(id, { variants: [{ ...f.variants[0], slots: [{ id: randomUUID(), taskId: curl, fillRule: null, sets: 3, targets: {}, minTargets: {}, stretchTargets: {} }] }] });
		const now = rowOn(id, d(-3))!;
		expect(positionsOf(now).map((p) => p.taskId)).toEqual([bench, dips]);
		expect(progressText(progressForIds([now.id]).get(now.id)!)).toBe(before);
		const P = prepare(loadDataset(me));
		expect(targetMetOfOcc(P.ds.occurrences.find((o) => o.id === now.id)!, P)).toBe(1);
		// Only the full target counting now: the old session still counts.
		edit(id, { minimumCounts: false });
		expect(statusOn(id, d(-3))).toBe('done');
		// Today's log has the new plan.
		loadToday(me, today);
		expect(positionsOf(rowOn(id, today)!)[0].taskId).toBe(curl);
	});
});

describe('moving a habit between groups (P0 5)', () => {
	it('counts it in the new group from the day it moved; past days and streaks stay', () => {
		const aarav = group('Aarav chores', 6);
		const maya = group('Maya chores', 6);
		const job = daily('Aarav: weekly job', 6, aarav);
		const tidy = daily('Aarav: tidy', 6, aarav);
		const trash = daily('Aarav: trash', 6, aarav);
		const mTidy = daily('Maya: tidy', 6, maya);
		for (let i = 1; i <= 6; i++) {
			run('log_done', { habit: job, date: d(-i) });
			run('log_done', { habit: tidy, date: d(-i) });
			run('log_done', { habit: mTidy, date: d(-i) });
			if (i !== 3) run('log_done', { habit: trash, date: d(-i) });
		}
		settleAll(me, today);
		expect(rowOn(aarav, d(-3))).toMatchObject({ status: 'missed', rollup: { done: 2, total: 3 } });
		expect(rowOn(maya, d(-3))).toMatchObject({ status: 'done', rollup: { done: 1, total: 1 } });

		expect(moveHabit(me, trash, null, today)).toEqual({ parentId: null });
		expect(moveHabit(me, trash, maya, today)).toEqual({ parentId: maya });
		expect(habitRow(trash).earlierParents).toEqual([{ until: d(-1), parentId: aarav }]);
		loadToday(me, today);
		expect(rowOn(aarav, d(-3))).toMatchObject({ status: 'missed', rollup: { done: 2, total: 3 } });
		expect(rowOn(maya, d(-3))).toMatchObject({ status: 'done', rollup: { done: 1, total: 1 } });
		expect(rowOn(maya, d(-1))).toMatchObject({ rollup: { done: 1, total: 1 } });
		// From today: trash counts for Maya only.
		expect(rowOn(maya, today)).toMatchObject({ rollup: { total: 2 } });
		expect(rowOn(aarav, today)).toMatchObject({ rollup: { total: 2 } });
		// A late log for a day it was still Aarav's counts for Aarav.
		run('log_done', { habit: trash, date: d(-3) });
		expect(rowOn(aarav, d(-3))).toMatchObject({ status: 'done', rollup: { done: 3, total: 3 } });
		expect(rowOn(maya, d(-3))).toMatchObject({ rollup: { done: 1, total: 1 } });
		// Moving back on the same day leaves no trace.
		moveHabit(me, trash, aarav, today);
		expect(habitRow(trash).earlierParents).toBeNull();
	});
});

describe('routines keep the right misses (P0 2, P0 3)', () => {
	it('a habit that follows a routine keeps its misses after Archive and Undo before Today loads', () => {
		const v = randomUUID();
		const start = d(-6);
		const r = save({ name: 'Evening routine', direction: 'build', startDate: start, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'interval', every: 1, start, variantId: v } });
		const kid = follower('Hygiene PM', r, 6);
		run('log_done', { habit: r, date: d(-6) });
		run('log_done', { habit: r, date: d(-4) });
		// Nothing has settled the routine's other days yet.
		archiveHabit(me, kid, today);
		unarchiveHabit(me, kid, today);
		settleAll(me, today);
		expect(missed(r)).toEqual([d(-5), d(-3), d(-2), d(-1)]);
		expect(missed(kid)).toEqual([d(-5), d(-3), d(-2), d(-1)]);
	});

	it('a habit moved out of a routine with a schedule of its own from today on keeps its past routine days', () => {
		const v = randomUUID();
		const start = d(-5);
		const r = save({ name: 'Roster', direction: 'build', startDate: start, variants: [{ id: v, name: 'Shift', slots: [] }], schedule: { kind: 'interval', every: 2, start, variantId: v } });
		const kid = follower('Pre-shift', r, 5);
		settleAll(me, today);
		expect(missed(kid)).toEqual([d(-5), d(-3), d(-1)]);
		const f = getHabitForm(me, kid)!;
		edit(kid, { parentId: null, schedule: { kind: 'interval', every: 3, start: today, variantId: f.variants[0].id } });
		loadToday(me, today);
		expect(missed(kid)).toEqual([d(-5), d(-3), d(-1)]);
		// A past day still opens as due, and logging it counts.
		run('log_done', { habit: kid, date: d(-3) });
		expect(rowOn(kid, d(-3))).toMatchObject({ status: 'done', extra: false });
	});

	it('a waiting rotation plans its later days again when a habit inside it is logged on a past day', () => {
		const a = randomUUID();
		const b = randomUUID();
		const c = randomUUID();
		const start = d(-20);
		const r = save({
			name: 'Training day',
			direction: 'build',
			startDate: start,
			variants: [{ id: a, name: 'Day A', slots: [] }, { id: b, name: 'Day B', slots: [] }, { id: c, name: 'Day C', slots: [] }],
			schedule: { kind: 'rotation', step: 'variant', order: [{ variantId: a, restDays: 1 }, { variantId: b, restDays: 1 }, { variantId: c, restDays: 2 }], onMiss: 'wait', weekdays: [], start }
		});
		const sa = follower('Strength A', r, 20, [a]);
		const sb = follower('Strength B', r, 20, [b]);
		const sc = follower('Strength C', r, 20, [c]);
		run('log_done', { habit: r, date: d(-20) }); // A
		run('log_done', { habit: r, date: d(-18) }); // B
		run('log_done', { habit: r, date: d(-16) }); // C
		run('log_done', { habit: r, date: d(-13) }); // A
		run('log_skip', { habit: r, date: d(-11) }); // B, skipped
		settleAll(me, today);
		// C waits from d(-9): a miss each time its gap comes round.
		expect(rowOn(r, d(-9))).toMatchObject({ status: 'missed', variantId: c });
		expect(missed(sc)).toContain(d(-7));

		// Strength C logged on d(-9): the routine's day is done, so A is next from d(-6).
		run('log_done', { habit: sc, date: d(-9) });
		expect(rowOn(r, d(-9))).toMatchObject({ status: 'done', variantId: c });
		expect(missed(sc)).toEqual([]);
		expect(rowOn(r, d(-7))).toBeUndefined();
		expect(rowOn(r, d(-6))).toMatchObject({ status: 'missed', variantId: a });
		expect(missed(sa)).toContain(d(-6));

		// Strength A at its day: the routine moves on to B.
		run('log_done', { habit: sa, date: d(-6) });
		expect(rowOn(r, d(-6))).toMatchObject({ status: 'done', variantId: a });
		expect(rowOn(r, d(-4))).toMatchObject({ status: 'missed', variantId: b });
		expect(missed(sa)).toEqual([]);
		expect(missed(sb)).toEqual([d(-4), d(-2)]);
		// The routine's Done on a past day marks the habit that follows that day's Variant.
		run('log_done', { habit: r, date: d(-3) });
		expect(rowOn(sb, d(-3))?.status).toBe('done');
		expect(rowOn(sc, d(-3))).toBeUndefined();
	});

	it('a routine\'s past day counts habits that follow it and were never logged as missed', () => {
		const v = randomUUID();
		const start = d(-4);
		const r = save({ name: 'Gym day', direction: 'build', startDate: start, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'interval', every: 2, start, variantId: v } });
		const gym = daily('Gym', 4, r);
		const warm = follower('Warm-up', r, 4);
		run('log_done', { habit: gym, date: d(-2) });
		settleAll(me, today);
		expect(statusOn(warm, d(-2))).toBe('missed');
		expect(rowOn(r, d(-2))).toMatchObject({ status: 'missed', rollup: { done: 1, total: 2 } });
		// A day the routine no longer has (its start moved later) takes the follower's miss with it.
		edit(r, { startDate: d(-3), schedule: { kind: 'interval', every: 2, start: d(-3), variantId: v } }, 'past');
		settleAll(me, today);
		expect(statusOn(warm, d(-2))).toBeNull();
		expect(missed(warm)).toEqual([d(-3), d(-1)]);
	});

	it('a routine in phases plans each phase\'s habits again after a past log', () => {
		const ramp = randomUUID();
		const keep = randomUUID();
		const start = d(-10);
		const r = save({
			name: 'Phased routine',
			direction: 'build',
			startDate: start,
			variants: [{ id: ramp, name: 'Ramp', slots: [] }, { id: keep, name: 'Keep', slots: [] }],
			schedule: {
				kind: 'phases',
				start,
				phases: [
					{ length: 5, unit: 'day', schedule: { kind: 'rotation', step: 'variant', order: [{ variantId: ramp, restDays: 1 }], onMiss: 'wait', weekdays: [], start } },
					{ length: null, unit: 'day', schedule: { kind: 'interval', every: 1, start, variantId: keep } }
				]
			}
		});
		const kid = follower('Ramp drill', r, 10, [ramp]);
		settleAll(me, today);
		expect(missed(kid)).toEqual([d(-10), d(-8), d(-6)]);
		run('log_done', { habit: kid, date: d(-10) });
		expect(statusOn(r, d(-10))).toBe('done');
		// Ramp is next due two days later, and the waiting misses move with it.
		expect(missed(r).filter((x) => x < d(-5))).toEqual([d(-8), d(-6)]);
		expect(missed(kid)).toEqual([d(-8), d(-6)]);
	});
});

describe('a program added from a template (v8)', () => {
	it('backfills a routine and the habits inside it with Started on', async () => {
		const { addTemplate } = await import('./repo/templates');
		const { shareFile } = await import('./share');
		const { templateFile } = await import('$lib/template');
		const v = randomUUID();
		const r = save({ name: 'Morning routine', direction: 'build', startDate: today, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'interval', every: 1, start: today, variantId: v } });
		follower('Meds AM', r, 0);
		const file = templateFile.parse(JSON.parse(JSON.stringify(shareFile(me, r))));
		const added = addTemplate(me, file, { today });
		if ('error' in added) throw new Error(added.error);
		const kid = db.select().from(habit).where(eq(habit.parentId, added.habitId)).get()!;
		// Started on, for the routine and the habit inside, as a backfill does.
		edit(added.habitId, { startDate: d(-3), schedule: { kind: 'interval', every: 1, start: d(-3), variantId: getHabitForm(me, added.habitId)!.variants[0].id } });
		edit(kid.id, { startDate: d(-3) });
		settleAll(me, today);
		expect(missed(added.habitId)).toEqual([d(-3), d(-2), d(-1)]);
		expect(missed(kid.id)).toEqual([d(-3), d(-2), d(-1)]);
	});
});
