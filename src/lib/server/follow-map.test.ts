// A habit that follows its routine with a Variant map, against a real (in-memory) database: each
// of the routine's Variants brings up one of the habit's, so a routine with its own rotation and
// a habit with Variants of its own go through them in step (swarm round 4: "Gym day" around
// "Gym"). Today follows the routine when its plan changes, and the map travels with Duplicate,
// templates and Programs, and through phases.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from './db';
import { habit, occurrence, variant } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { loadToday, settleAll, userToday } from './today';
import { copyHabitForm, deleteHabit, getHabitForm, saveHabit } from './repo/habits';
import { addTemplate } from './repo/templates';
import { shareFile } from './share';
import { habitForm, type HabitForm, type ScheduleForm } from '$lib/forms';
import { templateFile, TEMPLATE_VERSION, type TemplateFile } from '$lib/template';
import { addDays, weekday } from '$lib/engine/dates';
import { pairByName } from '$lib/engine/follow';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';

let me: string;
let app: Actor;
let today: string;
const d = (n: number) => addDays(today, n);

const run = (name: string, input: unknown = {}) => runAction(app, name, input) as Record<string, unknown>;
const rowOn = (habitId: string, date: string) =>
	db.select().from(occurrence).where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, date))).get();
const rows = (habitId: string) => db.select().from(occurrence).where(eq(occurrence.habitId, habitId)).orderBy(asc(occurrence.date)).all();
const save = (f: unknown) => saveHabit(me, null, habitForm.parse(f), today)!;
const edit = (id: string, patch: Partial<HabitForm>) => saveHabit(me, id, { ...getHabitForm(me, id)!, ...patch }, today);
const names = new Map<string, string>();
const nameOf = (variantId: string | null) => (variantId ? (names.get(variantId) ?? db.select().from(variant).where(eq(variant.id, variantId)).get()?.name ?? variantId) : null);
const roundTrip = (f: TemplateFile | null) => templateFile.parse(JSON.parse(JSON.stringify(f)));

/** Variants with fresh ids, remembered by name for the checks. */
function variants(...list: string[]) {
	return list.map((name) => {
		const id = randomUUID();
		names.set(id, name);
		return { id, name, slots: [] };
	});
}

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('follow-map', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
	app = appActor(me);
});

/** The swarm tester's routine: Upper A, Lower A, Upper B, Lower B with rest days, waiting on a miss. */
function gymDay(start: string) {
	const vs = variants('Upper A', 'Lower A', 'Upper B', 'Lower B');
	const id = save({
		name: `Gym day ${randomUUID().slice(0, 4)}`,
		direction: 'build',
		startDate: start,
		variants: vs,
		schedule: { kind: 'rotation', step: 'variant', order: vs.map((v, i) => ({ variantId: v.id, restDays: i === 3 ? 2 : 1 })), onMiss: 'wait', weekdays: [], start }
	});
	return { id, vs };
}

describe('a habit that follows its routine with a Variant map', () => {
	it('goes through its Variants in step with the routine’s rotation, misses and late logs included', () => {
		const start = d(-14);
		const r = gymDay(start);
		// Gym has the same four Variants: the editor pairs them by name when it starts following.
		const gymVs = variants('Upper A', 'Lower A', 'Upper B', 'Lower B');
		const gym = save({
			name: 'Gym',
			direction: 'build',
			startDate: start,
			variants: gymVs,
			schedule: { kind: 'follow', variantId: gymVs[0].id, on: null, map: pairByName(r.vs, gymVs) },
			parentId: r.id
		});
		// Bench only on Upper days: Heavy on Upper A, Light on Upper B.
		const benchVs = variants('Heavy', 'Light');
		const bench = save({
			name: 'Bench',
			direction: 'build',
			startDate: start,
			variants: benchVs,
			schedule: { kind: 'follow', variantId: benchVs[0].id, on: [r.vs[0].id, r.vs[2].id], map: { [r.vs[2].id]: benchVs[1].id } },
			parentId: r.id
		});
		expect(getHabitForm(me, gym)!.schedule).toMatchObject({ map: Object.fromEntries(r.vs.slice(1).map((v, i) => [v.id, gymVs[i + 1].id])) });

		// Upper A, Lower A, Upper B done on their days; Lower B (d(-8)) missed and waits; logged late on d(-5).
		run('log_done', { habit: r.id, date: d(-14) });
		run('log_done', { habit: r.id, date: d(-12) });
		run('log_done', { habit: r.id, date: d(-10) });
		run('log_done', { habit: r.id, date: d(-5) });
		run('log_done', { habit: r.id, date: d(-2) });
		settleAll(me, today);
		loadToday(me, today);

		const routineDays = rows(r.id).filter((x) => !x.extra);
		expect(routineDays.map((x) => [x.date, nameOf(x.variantId)])).toEqual(
			expect.arrayContaining([
				[d(-14), 'Upper A'],
				[d(-12), 'Lower A'],
				[d(-10), 'Upper B'],
				[d(-8), 'Lower B'],
				[d(-5), 'Lower B'],
				[d(-2), 'Upper A']
			])
		);
		// Every day the routine has, Gym has with the same Variant; Bench only on Upper days, Heavy or Light.
		for (const day of routineDays) {
			const want = nameOf(day.variantId);
			expect([day.date, nameOf(rowOn(gym, day.date)?.variantId ?? null)]).toEqual([day.date, want]);
			const b = rowOn(bench, day.date);
			expect([day.date, nameOf(b?.variantId ?? null)]).toEqual([day.date, want === 'Upper A' ? 'Heavy' : want === 'Upper B' ? 'Light' : null]);
		}
		// And nothing on the routine's rest days.
		const routineDates = new Set(routineDays.map((x) => x.date));
		expect(rows(gym).filter((x) => !routineDates.has(x.date)).map((x) => x.date)).toEqual([]);
		expect(rows(bench).filter((x) => !routineDates.has(x.date)).map((x) => x.date)).toEqual([]);
		// The routine's misses are the habits' misses, with the Variant they would have logged.
		expect(rowOn(gym, d(-8))).toMatchObject({ status: 'missed' });
		expect(nameOf(rowOn(gym, d(-8))!.variantId)).toBe('Lower B');
		expect(rowOn(gym, d(-5))).toMatchObject({ status: 'done' });
	});

	it('plans today again when the routine’s today changes, and leaves a day with something in it', () => {
		const wd = weekday(today);
		const rv = variants('Push', 'Pull');
		const weekly = (v: string): ScheduleForm => ({ kind: 'weekly', days: { [wd]: v } });
		const r = save({ name: 'Upper day', direction: 'build', startDate: d(-3), variants: rv, schedule: weekly(rv[0].id) });
		const kv = variants('Bench', 'Rows');
		const kid = save({
			name: 'Main lift',
			direction: 'build',
			startDate: d(-3),
			variants: kv,
			schedule: { kind: 'follow', variantId: kv[0].id, on: null, map: { [rv[1].id]: kv[1].id } },
			parentId: r
		});
		const ov = variants('Curl', 'Face pull');
		const other = save({
			name: 'Accessory',
			direction: 'build',
			startDate: d(-3),
			variants: ov,
			schedule: { kind: 'follow', variantId: ov[0].id, on: null, map: { [rv[1].id]: ov[1].id } },
			parentId: r
		});
		loadToday(me, today);
		expect(nameOf(rowOn(kid, today)!.variantId)).toBe('Bench');

		// The routine is Pull today from now on: Main lift's untouched today follows.
		edit(r, { schedule: weekly(rv[1].id) });
		loadToday(me, today);
		expect(nameOf(rowOn(r, today)!.variantId)).toBe('Pull');
		expect(nameOf(rowOn(kid, today)!.variantId)).toBe('Rows');

		// Logged, it stays as it was; the routine having nothing today takes the untouched one away.
		run('log_done', { habit: other });
		edit(r, { schedule: { kind: 'weekly', days: { [(wd + 1) % 7]: rv[0].id } } });
		loadToday(me, today);
		expect(rowOn(r, today)).toBeUndefined();
		expect(rowOn(kid, today)).toBeUndefined();
		expect(rowOn(other, today)).toMatchObject({ status: 'done' });
	});

	it('is saved with pairs it can use only, and copied onto the copy’s own Variants', () => {
		const r = gymDay(today);
		const kv = variants('Heavy', 'Light');
		const kid = save({
			name: 'Squat',
			direction: 'build',
			startDate: today,
			variants: kv,
			schedule: {
				kind: 'follow',
				variantId: kv[0].id,
				on: null,
				map: { [r.vs[0].id]: kv[0].id, [r.vs[1].id]: kv[1].id, [randomUUID()]: kv[1].id, [r.vs[2].id]: randomUUID() }
			},
			parentId: r.id
		});
		expect(getHabitForm(me, kid)!.schedule).toEqual({ kind: 'follow', variantId: kv[0].id, on: null, map: { [r.vs[1].id]: kv[1].id } });

		const copy = copyHabitForm(getHabitForm(me, kid)!);
		const light = copy.variants.find((v) => v.name === 'Light')!.id;
		expect(light).not.toBe(kv[1].id);
		expect(copy.schedule).toMatchObject({ map: { [r.vs[1].id]: light } });
	});

	it('travels in a Program and comes back paired with the new Variants', () => {
		const r = gymDay(d(-3));
		const kv = variants('Heavy', 'Light');
		save({
			name: 'Deadlift',
			direction: 'build',
			startDate: d(-3),
			variants: kv,
			schedule: { kind: 'follow', variantId: kv[0].id, on: [r.vs[1].id, r.vs[3].id], map: { [r.vs[3].id]: kv[1].id } },
			parentId: r.id
		});
		const file = roundTrip(shareFile(me, r.id));
		expect(file.version).toBe(TEMPLATE_VERSION);
		expect(TEMPLATE_VERSION).toBe(10);
		// By keys: the routine's v2 and v4 (Lower A, Lower B), Light is the habit's v2.
		expect(file.children[0].schedule).toEqual({ kind: 'follow', variantId: 'v1', on: ['v2', 'v4'], map: { v4: 'v2' } });

		const added = addTemplate(me, file, { today });
		if ('error' in added) throw new Error(added.error);
		const routine = getHabitForm(me, added.habitId)!;
		const lowerB = routine.variants.find((v) => v.name === 'Lower B')!.id;
		const kid = db.select().from(habit).where(eq(habit.parentId, added.habitId)).get()!;
		const kidForm = getHabitForm(me, kid.id)!;
		expect(kidForm.schedule).toEqual({
			kind: 'follow',
			variantId: kidForm.variants.find((v) => v.name === 'Heavy')!.id,
			on: [routine.variants.find((v) => v.name === 'Lower A')!.id, lowerB],
			map: { [lowerB]: kidForm.variants.find((v) => v.name === 'Light')!.id }
		});
	});

	it('follows a phased routine, and keeps its Variants by phase when the routine is deleted', () => {
		const rv = variants('Ramp-up', 'Heavy day', 'Light day');
		const wd = weekday(today);
		const start = d(-7);
		const r = save({
			name: 'Phased program',
			direction: 'build',
			startDate: start,
			variants: rv,
			schedule: {
				kind: 'phases',
				start,
				phases: [
					{ length: 1, unit: 'week', schedule: { kind: 'interval', every: 1, start, variantId: rv[0].id } },
					{ length: null, unit: 'week', schedule: { kind: 'weekly', days: { [wd]: rv[1].id, [(wd + 2) % 7]: rv[2].id } } }
				]
			}
		});
		const kv = variants('Easy', '5x5', '3x10');
		const kid = save({
			name: 'Squat program',
			direction: 'build',
			startDate: start,
			variants: kv,
			schedule: { kind: 'follow', variantId: kv[0].id, on: null, map: { [rv[1].id]: kv[1].id, [rv[2].id]: kv[2].id } },
			parentId: r
		});
		settleAll(me, today);
		loadToday(me, today);
		// Ramp-up week: Easy every day. Now in the second phase: today is a heavy day.
		expect(rows(kid).filter((x) => x.date < today).map((x) => nameOf(x.variantId))).toEqual(Array(7).fill('Easy'));
		expect(nameOf(rowOn(kid, today)!.variantId)).toBe('5x5');

		deleteHabit(me, r);
		const own = getHabitForm(me, kid)!.schedule;
		expect(own).toMatchObject({
			kind: 'phases',
			start,
			phases: [
				{ length: 1, unit: 'week', schedule: { kind: 'interval', every: 1, variantId: kv[0].id } },
				{ length: null, unit: 'week', schedule: { kind: 'weekly', days: { [wd]: kv[1].id, [(wd + 2) % 7]: kv[2].id } } }
			]
		});
	});
});
