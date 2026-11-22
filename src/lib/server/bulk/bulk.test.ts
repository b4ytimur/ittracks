// Bulk changes against a real (in-memory) database: the catalog and its links to the rules,
// each action's preview and apply, batch undo, and access.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { and, eq } from 'drizzle-orm';
import { getTableColumns } from 'drizzle-orm';
import { db } from '../db';
import { entry, event, habit, metric, occurrence, pause, slot, task } from '../db/schema';
import { createAccount } from '../auth';
import { saveSettings } from '../settings';
import { settleAll, userToday } from '../today';
import { startFrom } from '../backfill';
import { addTemplate } from '../repo/templates';
import { galleryItem } from '$lib/gallery';
import { addDays } from '$lib/engine/dates';
import { habitBulk, habitPast } from '$lib/rules/habit';
import { BULK, BULK_NAMES, buttonsFor } from '$lib/bulk/catalog';
import { appActor, type Actor } from '../core/actor';
import { actorForKey, createKey } from '../core/tokens';
import { catalog, runAction } from '../core/actions';

let me: string;
let app: Actor;
let today: string;
const ids: Record<string, string> = {};

const add = (slug: string, answers: Record<string, number | string | number[]> = {}) => {
	const r = addTemplate(me, galleryItem(slug)!.template, { today, answers });
	if ('error' in r) throw new Error(r.error);
	return r.habitId;
};
type Answer = {
	preview: boolean;
	batch: string | null;
	summary: string;
	count: number;
	changes: { id: string; label: string; detail?: string }[];
	skipped: { reason: string; items: { id: string; label: string; detail?: string }[] }[];
	notes: string[];
};
const bulk = (input: unknown, a: Actor = app) => runAction(a, 'bulk', input) as Answer;
const undo = (batch: string, a: Actor = app) => runAction(a, 'bulk_undo', { batch }) as { restored: number; kept: number; undone: string };
const dayOf = (habitId: string, date: string) =>
	db.select().from(occurrence).where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, date))).get();
const statusOn = (habitId: string, date: string) => dayOf(habitId, date)?.status ?? null;
const reasons = (r: Answer) => Object.fromEntries(r.skipped.map((s) => [s.reason, s.items.map((i) => i.label)]));

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('bulker', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
	app = appActor(me);
	ids.water = add('drink-water', { glasses: 8 });
	ids.read = add('reading', { pages: 10 });
	ids.walk = add('daily-walk');
	ids.meditate = add('meditation');
	ids.gym = add('beginner-5x5');
	ids.smoke = add('quit-smoking');
	// Started three weeks ago, so there are past days to skip.
	for (const h of [ids.water, ids.read, ids.walk, ids.meditate]) startFrom(db.select().from(habit).where(eq(habit.id, h)).get()!, addDays(today, -21));
});

describe('the catalog', () => {
	it('sets only display fields that are habit columns, and every action has buttons', () => {
		const columns = getTableColumns(habit);
		for (const k of Object.keys(habitBulk)) {
			expect(habitPast[k as keyof typeof habitPast].kind, k).toBe('display');
			expect(k in columns, k).toBe(true);
		}
		const buttons = [...buttonsFor('habit'), ...buttonsFor('task')].map((b) => b.action);
		for (const n of BULK_NAMES) expect(buttons, n).toContain(n);
		expect(buttonsFor('habit').map((b) => b.label)).toEqual(expect.arrayContaining(['Skip days', 'Pause', 'Area', 'Reminders']));
	});

	it('is in the v1 catalog with a JSON Schema for every action', () => {
		const c = catalog(app);
		const b = c.actions.find((a) => a.name === 'bulk')!;
		const text = JSON.stringify(b.input);
		for (const n of BULK_NAMES) expect(text).toContain(n);
		expect(c.actions.some((a) => a.name === 'bulk_undo')).toBe(true);
	});

	it('refuses unknown actions, missing selections and bad dates', () => {
		expect(() => bulk({ action: { name: 'delete_all' }, filter: {} })).toThrow();
		expect(() => bulk({ action: { name: 'skip_days', from: addDays(today, -2), to: today } })).toThrow(/Say which/);
		expect(() => bulk({ action: { name: 'skip_days', from: 'monday', to: today }, filter: {} })).toThrow(/YYYY-MM-DD/);
		expect(() => bulk({ action: { name: 'set', set: {} }, filter: {} })).toThrow(/at least one/);
	});
});

describe('skip_days', () => {
	const from = () => addDays(today, -6);
	const to = () => addDays(today, -4);

	it('previews without changing anything', () => {
		const before = db.select().from(occurrence).all().length;
		const r = bulk({ action: { name: 'skip_days', from: from(), to: to() }, ids: [ids.water, ids.read, ids.gym, ids.smoke] });
		expect(r.preview).toBe(true);
		expect(r.batch).toBeNull();
		expect(r.changes.map((c) => c.label)).toEqual(['Drink water', 'Read']);
		expect(r.changes[0].detail).toMatch(/^3 days/);
		const why = reasons(r);
		expect(why['Break habits count slips, not days']).toEqual(['Quit smoking']);
		expect(why['It has no fixed days, so no day counts as missed. Pause it instead']).toEqual(['5x5 strength']);
		expect(db.select().from(occurrence).all().length).toBe(before);
		expect(statusOn(ids.water, from())).not.toBe('skipped');
	});

	it('skips due days, keeps done days, tags events with the batch, and undoes them all', () => {
		runAction(app, 'log_done', { habit: ids.read, date: addDays(today, -5), how: 'mark' });
		const r = bulk({ action: { name: 'skip_days', from: from(), to: to() }, ids: [ids.water, ids.read], apply: true });
		expect(r.preview).toBe(false);
		expect(r.batch).toBeTruthy();
		expect(r.summary).toBe('Skipped 5 days of 2 habits');
		for (let i = 4; i <= 6; i++) expect(statusOn(ids.water, addDays(today, -i))).toBe('skipped');
		expect(statusOn(ids.read, addDays(today, -5))).toBe('done');
		expect(reasons(r)['Already done on some of these days, which stay done']).toEqual(['Read']);
		const tagged = db.select().from(event).where(eq(event.accountId, me)).all().filter((e) => e.data.batch === r.batch);
		expect(tagged.filter((e) => e.type === 'occurrence.skipped')).toHaveLength(5);
		expect(tagged.some((e) => e.type === 'bulk.applied')).toBe(true);

		const u = undo(r.batch!);
		expect(u.restored).toBe(5);
		expect(u.kept).toBe(0);
		// Back to what they were: due days nobody logged count as missed again.
		for (let i = 4; i <= 6; i++) expect(statusOn(ids.water, addDays(today, -i))).toBe('missed');
		expect(statusOn(ids.read, addDays(today, -5))).toBe('done');
		expect(() => undo(r.batch!)).toThrow(/already undone/);
	});

	it('keeps a day logged by hand after the batch', () => {
		const r = bulk({ action: { name: 'skip_days', from: from(), to: to() }, ids: [ids.walk], apply: true });
		runAction(app, 'log_done', { habit: ids.walk, date: from(), how: 'mark' });
		const u = undo(r.batch!);
		expect(u).toMatchObject({ restored: 2, kept: 1 });
		expect(statusOn(ids.walk, from())).toBe('done');
	});

	it('includes today, leaves the future out, and respects the past-day window', () => {
		saveSettings(me, { pastDays: 1 });
		const r = bulk({ action: { name: 'skip_days', from: addDays(today, -5), to: addDays(today, 3) }, ids: [ids.meditate] });
		expect(r.changes[0].detail).toMatch(/^2 days/);
		expect(r.notes.join(' ')).toMatch(/after today/);
		expect(r.notes.join(' ')).toMatch(/too far back/);
		saveSettings(me, { pastDays: null });
	});
});

describe('set', () => {
	it('moves habits to an Area by name, and puts them back on undo', () => {
		const before = Object.fromEntries([ids.water, ids.read].map((h) => [h, db.select({ a: habit.areaId }).from(habit).where(eq(habit.id, h)).get()!.a]));
		const r = bulk({ action: { name: 'set', set: { areaId: 'mind' } }, ids: ['Drink water', 'read'], apply: true });
		expect(r.summary).toBe('Set Area: Mind for 2 habits');
		const learning = db.select({ a: habit.areaId }).from(habit).where(eq(habit.id, ids.water)).get()!.a;
		expect(learning).toBeTruthy();
		expect(db.select({ a: habit.areaId }).from(habit).where(eq(habit.id, ids.read)).get()!.a).toBe(learning);
		expect(bulk({ action: { name: 'set', set: { areaId: 'Mind' } }, ids: [ids.water] }).skipped[0].reason).toBe('Already set');
		undo(r.batch!);
		for (const h of [ids.water, ids.read]) expect(db.select({ a: habit.areaId }).from(habit).where(eq(habit.id, h)).get()!.a).toBe(before[h]);
		expect(() => bulk({ action: { name: 'set', set: { areaId: 'Nowhere' } }, filter: {} })).toThrow(/No Area called/);
	});

	it('turns reminders on only where the conflict rules allow', () => {
		const r = bulk({ action: { name: 'set', set: { remind: true } }, filter: {} });
		expect(r.changes.map((c) => c.label).sort()).toEqual(['Meditate', 'Read']);
		const why = reasons(r);
		expect(why['Set a time or a part of the day first']).toEqual(expect.arrayContaining(['Drink water', 'Walk']));
		expect(why['Only build habits use this']).toEqual(['Quit smoking']);
	});
});

describe('pause', () => {
	it('pauses habits, takes back past misses, and undo counts them again', () => {
		settleAll(me, today);
		const d = addDays(today, -10);
		expect(statusOn(ids.water, d)).toBe('missed');
		const r = bulk({ action: { name: 'pause', from: d, to: addDays(today, 2), note: 'Flu' }, ids: [ids.water, ids.walk], apply: true });
		expect(r.count).toBe(2);
		expect(statusOn(ids.water, d)).toBeNull();
		expect(db.select().from(pause).where(eq(pause.accountId, me)).all()).toHaveLength(2);
		expect(bulk({ action: { name: 'pause', from: addDays(today, -9), to: today }, ids: [ids.water] }).skipped[0].reason).toBe('Already paused on these days');
		undo(r.batch!);
		expect(db.select().from(pause).where(eq(pause.accountId, me)).all()).toHaveLength(0);
		expect(statusOn(ids.water, d)).toBe('missed');
	});
});

describe('convert_unit', () => {
	const weights = () =>
		db
			.select({ id: metric.id, unit: metric.unit, task: task.name })
			.from(metric)
			.innerJoin(task, eq(metric.taskId, task.id))
			.where(and(eq(task.accountId, me), eq(metric.name, 'Weight')))
			.all();
	const squat = () => db.select().from(task).where(and(eq(task.accountId, me), eq(task.name, 'Squat'))).get()!;
	const squatWeight = () => weights().find((w) => w.task === 'Squat')!.id;
	const squatTargets = () =>
		db
			.select({ t: slot.targets })
			.from(slot)
			.where(eq(slot.taskId, squat().id))
			.all()
			.map((s) => s.t?.[squatWeight()]);

	beforeAll(() => {
		runAction(app, 'log_task', { habit: '5x5 strength', task: 'Squat', sets: [{ weight: 62.5, reps: 5 }, { weight: 60, reps: 5 }], extra: true });
	});

	it('converts every Weight field from kg to lb, values and targets, and undo puts the exact numbers back', () => {
		expect(weights().length).toBe(5);
		expect(squatTargets()).toEqual([20, 20]);
		const r = bulk({ action: { name: 'convert_unit', field: 'weight', to: 'lbs', values: 'convert' }, filter: {}, apply: true });
		expect(r.count).toBe(5);
		expect(weights().every((w) => w.unit === 'lb')).toBe(true);
		expect(r.changes.find((c) => c.label === 'Squat › Weight')?.detail).toBe('kg → lb, 2 values and 2 targets converted');
		expect(reasons(r)['No field called “weight”']).toEqual(['Meditation', 'Reading', 'Walk', 'Water']);
		const vals = () =>
			db
				.select({ v: entry.values })
				.from(entry)
				.where(eq(entry.taskId, squat().id))
				.all()
				.map((e) => e.v[squatWeight()]);
		expect(vals()).toEqual([137.789, 132.277]);
		expect(squatTargets()).toEqual([44.092, 44.092]);
		expect(db.select().from(event).where(eq(event.type, 'metric.unit_changed')).all().some((e) => e.data.batch === r.batch)).toBe(true);

		undo(r.batch!);
		expect(weights().every((w) => w.unit === 'kg')).toBe(true);
		expect(vals()).toEqual([62.5, 60]);
		expect(squatTargets()).toEqual([20, 20]);
	});

	it('relabels, refuses units that do not convert, and skips non-number fields', () => {
		const convert = bulk({ action: { name: 'convert_unit', field: 'Weight', to: 'plates', values: 'convert' }, filter: {} });
		expect(convert.count).toBe(0);
		expect(convert.skipped[0].reason).toMatch(/kg can't be converted to plates/);
		const relabel = bulk({ action: { name: 'convert_unit', field: 'Weight', to: 'plates', values: 'relabel' }, ids: ['Squat'] });
		expect(relabel.changes[0].detail).toBe('kg → plates, numbers kept');
		const book = bulk({ action: { name: 'convert_unit', field: 'Book', to: 'kg', values: 'relabel' }, filter: {} });
		expect(reasons(book)['Only numbers, counts and durations have a unit']).toEqual(['Reading › Book']);
	});

	it('converts values logged after the change back on undo', () => {
		const r = bulk({ action: { name: 'convert_unit', field: 'Weight', to: 'lb', values: 'convert' }, ids: ['Squat'], apply: true });
		runAction(app, 'log_task', { habit: '5x5 strength', task: 'Squat', sets: [{ weight: 135, reps: 5 }], replace: false, extra: true });
		undo(r.batch!);
		const vs = db
			.select({ v: entry.values })
			.from(entry)
			.where(eq(entry.taskId, squat().id))
			.all()
			.map((e) => e.v[squatWeight()]);
		expect(vs).toContain(61.235);
		expect(vs).toContain(62.5);
	});
});

describe('undo order and access', () => {
	it('undoes only the latest batch', () => {
		const a = bulk({ action: { name: 'set', set: { areaId: 'Fitness' } }, ids: [ids.water], apply: true });
		const b = bulk({ action: { name: 'set', set: { areaId: 'Mind' } }, ids: [ids.water], apply: true });
		expect(() => undo(a.batch!)).toThrow(/later bulk change first/);
		undo(b.batch!);
		undo(a.batch!);
	});

	it('needs edit access for edits, and log access for skips', () => {
		const logOnly = createKey(me, { name: 'Log', scopes: ['log', 'read'], habitIds: null });
		if ('error' in logOnly) throw new Error(logOnly.error);
		const k = actorForKey(logOnly.secret)!;
		expect(() => bulk({ action: { name: 'set', set: { remind: false } }, filter: {} }, k)).toThrow(/edit/i);
		expect(bulk({ action: { name: 'skip_days', from: addDays(today, -1), to: addDays(today, -1) }, ids: [ids.water] }, k).preview).toBe(true);
		const limited = createKey(me, { name: 'Water', scopes: ['log', 'edit'], habitIds: [ids.water] });
		if ('error' in limited) throw new Error(limited.error);
		const l = actorForKey(limited.secret)!;
		expect(() => bulk({ action: { name: 'convert_unit', field: 'Weight', to: 'lb', values: 'convert' }, filter: {} }, l)).toThrow(/limited/);
		expect(bulk({ action: { name: 'set', set: { remind: false } }, filter: {} }, l).skipped.flatMap((s) => s.items.map((i) => i.id))).toEqual([ids.water]);
		expect(BULK.set.scope).toBe('edit');
	});
});
