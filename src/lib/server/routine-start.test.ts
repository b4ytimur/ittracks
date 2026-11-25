// A rotating habit put into a routine starts the routine where the habit is now:
// Gym on Upper B that starts to follow a new Gym day rotation makes Gym day start at Upper B. A
// routine whose rotation is under way keeps its place, and the change's Undo puts the routine back.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { occurrence, variant } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { loadToday, settleAll, userToday } from './today';
import { getHabitForm, saveHabit } from './repo/habits';
import { patchHabit } from './habit-patch';
import { restoreSnapshot } from './snapshot';
import { habitForm } from '$lib/forms';
import { addDays } from '$lib/engine/dates';
import { pairByName, rotationStartingAt } from '$lib/engine/follow';
import type { Rotation } from '$lib/engine/schedule';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';

let me: string;
let app: Actor;
let today: string;
const d = (n: number) => addDays(today, n);
const run = (name: string, input: unknown = {}) => runAction(app, name, input) as Record<string, unknown>;
const save = (f: unknown) => saveHabit(me, null, habitForm.parse(f), today)!;
const nameOf = (id: string | null | undefined) => (id ? db.select({ name: variant.name }).from(variant).where(eq(variant.id, id)).get()?.name : null);
const todayOf = (habitId: string) => db.select().from(occurrence).where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, today))).get();
const firstOf = (habitId: string) => nameOf((getHabitForm(me, habitId)!.schedule as Rotation).order[0].variantId);

const variants = (...list: string[]) => list.map((name) => ({ id: randomUUID(), name, slots: [] }));
const rotation = (vs: { id: string }[], start: string) => ({ kind: 'rotation', step: 'variant', order: vs.map((v) => ({ variantId: v.id, restDays: 0 })), onMiss: 'wait', weekdays: [], start });

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('routinestart', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
	app = appActor(me);
});

/** Gym with its own rotation, done Upper A and Lower A: it is on Upper B now. */
function gymOnUpperB(name: string) {
	const vs = variants('Upper A', 'Lower A', 'Upper B', 'Lower B');
	const id = save({ name, direction: 'build', startDate: d(-4), variants: vs, schedule: rotation(vs, d(-4)) });
	settleAll(me, today);
	run('log_done', { habit: id, date: d(-2) });
	run('log_done', { habit: id, date: d(-1) });
	return { id, vs };
}
function gymDay(name: string, start = today) {
	const vs = variants('Upper A', 'Lower A', 'Upper B', 'Lower B');
	return { id: save({ name, direction: 'build', startDate: start, variants: vs, schedule: rotation(vs, start) }), vs };
}
/** Gym starts to follow the routine, its Variants paired by name, from the editor. */
function follow(gym: { id: string; vs: { id: string; name: string }[] }, r: { id: string; vs: { id: string; name: string }[] }) {
	const was = getHabitForm(me, gym.id)!;
	const schedule = { kind: 'follow', variantId: gym.vs[0].id, on: null, map: pairByName(r.vs, gym.vs) };
	return patchHabit(me, gym.id, { set: { parentId: r.id, schedule }, was: { parentId: was.parentId, schedule: was.schedule }, applies: 'today', keep: false }, today) as { form: unknown; undo?: string; said?: string };
}

describe('a rotating habit put into a routine', () => {
	it('starts the routine at the Variant the habit is on now, and says so', () => {
		const gym = gymOnUpperB('Gym');
		const r = gymDay('Gym day');
		loadToday(me, today);
		expect(nameOf(todayOf(r.id)?.variantId)).toBe('Upper A');

		const res = follow(gym, r);
		expect(res.said).toBe('Gym day starts at Upper B, where Gym is now.');
		expect((getHabitForm(me, r.id)!.schedule as Rotation).order.map((o) => nameOf(o.variantId))).toEqual(['Upper B', 'Lower B', 'Upper A', 'Lower A']);
		loadToday(me, today);
		expect([nameOf(todayOf(r.id)?.variantId), nameOf(todayOf(gym.id)?.variantId)]).toEqual(['Upper B', 'Upper B']);

		// Its Undo puts both back: Gym on its own rotation, Gym day starting at Upper A.
		expect(res.undo && restoreSnapshot(me, res.undo)).toBe(true);
		expect(getHabitForm(me, gym.id)!.schedule?.kind).toBe('rotation');
		expect(firstOf(r.id)).toBe('Upper A');
	});

	it('a routine already under way keeps its place', () => {
		const gym = gymOnUpperB('Gym 2');
		const r = gymDay('Gym day 2', d(-1));
		settleAll(me, today);
		run('log_done', { habit: r.id, date: d(-1) });
		const res = follow(gym, r);
		expect(res.said).toBeUndefined();
		expect(firstOf(r.id)).toBe('Upper A');
	});

	it('turns the order the fewest steps that bring the Variant up first, rest days and all', () => {
		const ids = ['a', 'b', 'c'];
		const r: Rotation = { kind: 'rotation', step: 'variant', order: ids.map((v, i) => ({ variantId: v, restDays: i })), onMiss: 'skip', weekdays: [], start: '2026-11-25' };
		const f = { kind: 'follow' as const, variantId: 'x', on: null, map: { a: 'x', b: 'y', c: 'z' } };
		expect(rotationStartingAt(r, f, 'z', '2026-11-25')?.order).toEqual([
			{ variantId: 'c', restDays: 2 },
			{ variantId: 'a', restDays: 0 },
			{ variantId: 'b', restDays: 1 }
		]);
		expect(rotationStartingAt(r, f, 'x', '2026-11-25')).toBeNull();
		expect(rotationStartingAt(r, f, 'nowhere', '2026-11-25')).toBeNull();
	});
});
