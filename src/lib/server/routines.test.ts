// Routines against a real (in-memory) database: a habit with its own schedule and habits inside
// it. Habits that follow it are due on its days (or only with some of its Variants), its days
// are judged from them, Done, Skip and Undo on it mark them, and it stays sound when edited.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { habit, occurrence, pause } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { loadToday, recount, repaused, settleAll, userToday } from './today';
import { restore, snapshot } from './backfill';
import { undoRoutine, withRoutineUndo } from './routine-day';
import { checkHabitEdit, checkLinks, deleteHabit, getHabitForm, saveHabit } from './repo/habits';
import { habitForm, type HabitForm, type ScheduleForm } from '$lib/forms';
import { addDays, weekday } from '$lib/engine/dates';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';
import { doneOcc, reopenOcc, skipOcc } from './core/log';

let me: string;
let app: Actor;
let today: string;

const run = (name: string, input: unknown = {}) => runAction(app, name, input) as Record<string, unknown>;
const rowOn = (habitId: string, date: string) =>
	db.select().from(occurrence).where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, date))).get();

/** A daily routine with no Tasks of its own, started `ago` days back. Returns its id and Variant. */
function routine(name: string, ago: number, rollup?: { target: number | null; minimum: number | null }) {
	const v = randomUUID();
	const start = addDays(today, -ago);
	const id = saveHabit(
		me,
		null,
		habitForm.parse({ name, direction: 'build', startDate: start, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'interval', every: 1, start, variantId: v, rollup } }),
		today
	)!;
	return { id, v };
}

/** A habit inside `parentId` that follows it (on some of its Variants, when `on` is set). */
function follower(name: string, parentId: string, ago: number, on: string[] | null = null): string {
	const v = randomUUID();
	return saveHabit(
		me,
		null,
		habitForm.parse({ name, direction: 'build', startDate: addDays(today, -ago), variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'follow', variantId: v, on }, parentId }),
		today
	)!;
}

const occOf = (habitId: string, date = today) => rowOn(habitId, date)!;

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('routines', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
	app = appActor(me);
});

describe('habits that follow a routine', () => {
	it('are due on its days, and its day is judged from theirs', () => {
		const r = routine('Morning', 0);
		const a = follower('Meditate', r.id, 0);
		const b = follower('Stretch', r.id, 0);
		let t = loadToday(me, today);
		const card = t.build.find((x) => x.habitId === r.id)!;
		expect(card.group).toMatchObject({ routine: true, done: 0, total: 2, kids: [a, b] });
		expect(t.build.find((x) => x.habitId === a)?.parentId).toBe(r.id);

		run('log_done', { habit: a });
		t = loadToday(me, today);
		expect(t.build.find((x) => x.habitId === r.id)).toMatchObject({ occurrence: { status: 'due' }, group: { done: 1, total: 2 } });
		run('log_done', { habit: b });
		t = loadToday(me, today);
		expect(t.build.find((x) => x.habitId === r.id)?.occurrence?.status).toBe('done');
	});

	it('judge its day again as soon as one of them is marked', () => {
		const r = routine('Judged at once', 0);
		const a = follower('First', r.id, 0);
		follower('Second', r.id, 0);
		loadToday(me, today);
		doneOcc(app, occOf(a), 'mark', null);
		expect(occOf(r.id)).toMatchObject({ status: 'due', rollup: { done: 1, total: 2 } });
		reopenOcc(app, occOf(a), false);
		expect(occOf(r.id)).toMatchObject({ rollup: { done: 0, total: 2 } });
	});

	it('only come up with the Variants they follow', () => {
		const a = randomUUID();
		const b = randomUUID();
		const wd = weekday(today);
		const id = saveHabit(
			me,
			null,
			habitForm.parse({
				name: 'Gym',
				direction: 'build',
				startDate: today,
				variants: [
					{ id: a, name: 'Upper', slots: [] },
					{ id: b, name: 'Lower', slots: [] }
				],
				schedule: { kind: 'weekly', days: { [wd]: a, [(wd + 1) % 7]: b } }
			}),
			today
		)!;
		const upper = follower('Bench', id, 0, [a]);
		const lower = follower('Squat', id, 0, [b]);
		const t = loadToday(me, today);
		expect(t.build.map((x) => x.habitId)).toContain(upper);
		expect(t.build.map((x) => x.habitId)).not.toContain(lower);
		expect(t.build.find((x) => x.habitId === id)?.group).toMatchObject({ total: 1 });
	});

	it('miss the days nobody logged, and a Minimum makes a short past day done at the Minimum', () => {
		const r = routine('Evening', 2, { target: null, minimum: 1 });
		const a = follower('Read', r.id, 2);
		follower('Journal', r.id, 2);
		const d2 = addDays(today, -2);
		const d1 = addDays(today, -1);
		settleAll(me, today);
		expect(rowOn(a, d2)?.status).toBe('missed');
		expect(rowOn(r.id, d2)).toMatchObject({ status: 'missed', rollup: { done: 0, total: 2 } });
		run('log_done', { habit: a, date: d1 });
		settleAll(me, today);
		expect(rowOn(r.id, d1)).toMatchObject({ status: 'done', level: 'minimum', rollup: { done: 1, total: 2 } });
	});

	it('a past day marked Done reaches habits inside that were never logged that day', () => {
		const r = routine('Ignored days', 1);
		const a = follower('Quiet', r.id, 1);
		db.update(habit).set({ unlogged: 'ignore' }).where(eq(habit.id, a)).run();
		const d1 = addDays(today, -1);
		settleAll(me, today);
		expect(rowOn(a, d1)).toBeUndefined();
		run('log_done', { habit: r.id, date: d1 });
		expect(rowOn(a, d1)?.status).toBe('done');
		expect(rowOn(r.id, d1)).toMatchObject({ status: 'done', rollup: { done: 1, total: 1 } });
	});

	it('Undo of a past day puts back the habits inside too', () => {
		const r = routine('Undoable', 1);
		const a = follower('Inside undoable', r.id, 1);
		const d1 = addDays(today, -1);
		settleAll(me, today);
		const before = snapshot(r.id, d1);
		expect(before.below).toHaveLength(1);
		run('log_done', { habit: r.id, date: d1 });
		expect([rowOn(a, d1)?.status, rowOn(r.id, d1)?.status]).toEqual(['done', 'done']);
		expect(restore(me, before)).toBe(true);
		const h = db.select().from(habit).where(eq(habit.id, r.id)).get()!;
		recount(me, r.id, h.schedule as ScheduleForm, d1, today);
		expect([rowOn(a, d1)?.status, rowOn(r.id, d1)?.status]).toEqual(['missed', 'missed']);
	});

	it('done at Stretch when every one of them was', () => {
		const r = routine('Warm-up', 0);
		const a = follower('Jog', r.id, 0);
		const b = follower('Mobility', r.id, 0);
		loadToday(me, today);
		doneOcc(app, occOf(a), 'mark', 'stretch');
		doneOcc(app, occOf(b), 'mark', 'stretch');
		loadToday(me, today);
		expect(occOf(r.id)).toMatchObject({ status: 'done', level: 'stretch' });
	});
});

describe('Done, Skip and Undo on a routine', () => {
	it('mark the habits inside it', () => {
		const r = routine('Night', 0);
		const a = follower('Floss', r.id, 0);
		const b = follower('Lay out clothes', r.id, 0);
		loadToday(me, today);
		doneOcc(app, occOf(a), 'mark', null);
		expect(doneOcc(app, occOf(r.id), 'mark', null)).toBe('done');
		expect([occOf(a).status, occOf(b).status, occOf(r.id).status]).toEqual(['done', 'done', 'done']);

		reopenOcc(app, occOf(r.id), false);
		expect([occOf(a).status, occOf(b).status, occOf(r.id).status]).toEqual(['due', 'due', 'due']);

		doneOcc(app, occOf(a), 'mark', null);
		skipOcc(app, occOf(r.id));
		// Done stays done; the rest is skipped, so the day counts the one that was done.
		expect([occOf(a).status, occOf(b).status]).toEqual(['done', 'skipped']);
		expect(occOf(r.id)).toMatchObject({ status: 'done', rollup: { done: 1, total: 1 } });
	});

	it('taken back puts back exactly what it marked, and nothing that was done before or changed since', () => {
		const r = routine('Night', 0);
		const [a, b, c] = ['Teeth', 'Read', 'Plan'].map((n) => follower(n, r.id, 0));
		loadToday(me, today);
		run('log_done', { habit: a });
		const { undo } = withRoutineUndo(occOf(r.id), () => doneOcc(app, occOf(r.id), 'mark', null));
		expect([a, b, c].map((x) => occOf(x).status)).toEqual(['done', 'done', 'done']);
		// One of them changes before the Undo: it stays as it is now.
		db.update(occurrence).set({ notes: 'kept' }).where(eq(occurrence.id, occOf(c).id)).run();
		expect(undoRoutine(app, occOf(r.id), undo!)).toBe(true);
		expect([a, b, c].map((x) => occOf(x).status)).toEqual(['done', 'due', 'done']);
		expect(occOf(r.id).status).toBe('due');
		const skip = withRoutineUndo(occOf(r.id), () => skipOcc(app, occOf(r.id)));
		expect(occOf(b).status).toBe('skipped');
		expect(undoRoutine(app, occOf(r.id), skip.undo!)).toBe(true);
		expect([a, b, c].map((x) => occOf(x).status)).toEqual(['done', 'due', 'done']);
		// Another routine's, or nonsense: nothing.
		expect(undoRoutine(app, occOf(a), undo!)).toBe(false);
		expect(undoRoutine(app, occOf(r.id), 'x')).toBe(false);
		expect(withRoutineUndo(occOf(a), () => 1)).toEqual({ result: 1 });
	});

	it('through the API too', () => {
		const r = routine('Lunch walk', 0);
		const a = follower('Walk', r.id, 0);
		loadToday(me, today);
		expect(run('log_done', { habit: r.id })).toMatchObject({ status: 'done' });
		expect(occOf(a).status).toBe('done');
	});
});

describe('bulk Skip on a routine', () => {
	it('skips the habits inside on those days, and its Undo opens them again', () => {
		const r = routine('Bulk routine', 2);
		const a = follower('Bulk inside', r.id, 2);
		db.update(habit).set({ unlogged: 'ignore' }).where(eq(habit.id, a)).run();
		const d2 = addDays(today, -2);
		const d1 = addDays(today, -1);
		settleAll(me, today);
		const res = run('bulk', { action: { name: 'skip_days', from: d2, to: d1 }, ids: [r.id, a], apply: true }) as { batch: string };
		expect([rowOn(a, d2)?.status, rowOn(a, d1)?.status, rowOn(r.id, d2)?.status]).toEqual(['skipped', 'skipped', 'skipped']);
		run('bulk_undo', { batch: res.batch });
		expect([rowOn(a, d2), rowOn(a, d1), rowOn(r.id, d2)?.status]).toEqual([undefined, undefined, 'missed']);
	});
});

describe('a routine inside a routine', () => {
	it('is judged from its own habits and judges the one it sits in, and Done marks all the way down', () => {
		const r = routine('Saturday', 0);
		const inner = follower('Cleaning', r.id, 0);
		const k1 = follower('Vacuum', inner, 0);
		const k2 = follower('Dishes', inner, 0);
		let t = loadToday(me, today);
		expect(t.build.find((x) => x.habitId === inner)?.group).toMatchObject({ routine: true, total: 2 });
		run('log_done', { habit: k1 });
		t = loadToday(me, today);
		expect(occOf(inner)).toMatchObject({ status: 'due', rollup: { done: 1, total: 2 } });
		expect(occOf(r.id)).toMatchObject({ status: 'due', rollup: { done: 0, total: 1 } });
		run('log_done', { habit: r.id });
		expect([occOf(k1).status, occOf(k2).status, occOf(inner).status, occOf(r.id).status]).toEqual(['done', 'done', 'done', 'done']);
		reopenOcc(app, occOf(r.id), false);
		expect([occOf(k2).status, occOf(inner).status, occOf(r.id).status]).toEqual(['due', 'due', 'due']);
	});

	it('a pause on the outer one takes the days of everything following it', () => {
		const r = routine('Holiday-proof', 2);
		const inner = follower('Inner', r.id, 2);
		const k = follower('Deep', inner, 2);
		const d2 = addDays(today, -2);
		settleAll(me, today);
		expect([rowOn(r.id, d2)?.status, rowOn(inner, d2)?.status, rowOn(k, d2)?.status]).toEqual(['missed', 'missed', 'missed']);
		db.insert(pause).values({ id: randomUUID(), accountId: me, habitId: r.id, start: d2, end: d2, note: null }).run();
		repaused(me, r.id, d2, d2, today);
		expect([rowOn(r.id, d2), rowOn(inner, d2), rowOn(k, d2)]).toEqual([undefined, undefined, undefined]);
	});
});

describe('keeping the tree sound', () => {
	const form = (id: string) => getHabitForm(me, id)!;

	it('a habit follows only a routine it sits in, and a routine has no Tasks of its own', () => {
		const r = routine('Routine A', 0);
		const k = follower('Inside A', r.id, 0);
		const loose: HabitForm = { ...form(k), parentId: null };
		expect(checkLinks(me, k, loose)).toMatch(/only follow a routine/);
		const g = saveHabit(me, null, habitForm.parse({ name: 'A group', direction: 'build', startDate: today, variants: [], schedule: { kind: 'group', target: null, minimum: null } }), today)!;
		expect(checkLinks(me, k, { ...form(k), parentId: g })).toMatch(/only follow a routine/);
		const withTask = { ...form(r.id) };
		withTask.variants = withTask.variants.map((v) => ({ ...v, slots: [{ id: randomUUID(), taskId: null, fillRule: null, sets: null, targets: {}, minTargets: {}, stretchTargets: {} }] }));
		expect(checkLinks(me, r.id, withTask)).toMatch(/no Tasks of its own/);
		expect(checkHabitEdit(me, r.id, { ...form(r.id), variants: [], schedule: { kind: 'group', target: null, minimum: null } })).toMatch(/follow its schedule/);
	});

	it('a group sits only inside another group', () => {
		const r = routine('Routine B', 0);
		const asGroup = habitForm.parse({ name: 'G', direction: 'build', startDate: today, variants: [], schedule: { kind: 'group', target: null, minimum: null }, parentId: r.id });
		expect(checkLinks(me, null, asGroup)).toMatch(/inside another group/);
	});

	it('a habit that followed a deleted routine inside a routine gets the outer one’s days', () => {
		const v = randomUUID();
		const outer = saveHabit(
			me,
			null,
			habitForm.parse({ name: 'Every other day', direction: 'build', startDate: today, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'interval', every: 2, start: today, variantId: v } }),
			today
		)!;
		const inner = follower('Middle', outer, 0);
		const k = follower('Bottom', inner, 0);
		deleteHabit(me, inner);
		expect(db.select().from(habit).where(eq(habit.id, k)).get()!.schedule).toMatchObject({ kind: 'interval', every: 2 });
	});

	it('a habit that followed a deleted routine gets the routine’s days as its own', () => {
		const r = routine('Short-lived', 0);
		const k = follower('Left behind', r.id, 0);
		deleteHabit(me, r.id);
		const after = db.select().from(habit).where(eq(habit.id, k)).get()!;
		expect(after.parentId).toBeNull();
		expect(after.schedule).toMatchObject({ kind: 'interval', every: 1 });
	});
});
