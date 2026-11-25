// One line of a Task at a time, and taking back what touched logged values.
import { takePack } from './packs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { entry, metric, occurrence, slot } from './db/schema';
import { createAccount } from './auth';
import { getTaskForm, saveTask } from './repo/tasks';
import { saveHabit } from './repo/habits';
import { patchTask, taskPatch } from './task-patch';
import { restoreTaskSnapshot } from './task-snapshot';
import { appActor } from './core/actor';
import { habitForm, taskForm } from '$lib/forms';

let me: string;
let other: string;
let id: string;
let w: string;
let slotId: string;
const today = '2026-11-22';
const form = () => getTaskForm(me, id)!;
const patch = (set: Record<string, unknown>, was: Record<string, unknown>, o: Record<string, unknown> = {}, who = me) => patchTask(appActor(who, undefined), id, taskPatch.parse({ set, was, ...o }));
const weights = () => db.select().from(entry).where(eq(entry.taskId, id)).all().map((e) => (e.values as Record<string, number>)[w]);

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('tpatch', 'correct horse battery');
	takePack(me, 'gym'); // kg and lb convert
	other = await createAccount('tpatch-other', 'correct horse battery');
});
beforeEach(() => {
	w = crypto.randomUUID();
	id = saveTask(me, null, taskForm.parse({ name: `Squat ${w}`, restTimerEnabled: false, restTimerSeconds: 90, tags: [], metrics: [{ id: w, name: 'Weight', type: 'number', unit: 'kg', repeats: true }], parts: [] }))!;
	const v = crypto.randomUUID();
	slotId = crypto.randomUUID();
	const h = saveHabit(me, null, habitForm.parse({ name: 'Legs', direction: 'build', startDate: '2026-11-01', variants: [{ id: v, name: 'A', slots: [{ id: slotId, taskId: id, fillRule: null, sets: 3, targets: { [w]: 100 } }] }], schedule: { kind: 'interval', every: 1, start: '2026-11-01', variantId: v } }), today)!;
	const o = crypto.randomUUID();
	db.insert(occurrence).values({ id: o, habitId: h, variantId: v, date: '2026-11-20', status: 'done' }).run();
	for (const kg of [100, 102.5]) db.insert(entry).values({ id: crypto.randomUUID(), occurrenceId: o, taskId: id, path: slotId, values: { [w]: kg }, sortOrder: 0 }).run();
});

describe('a change to one line of a Task', () => {
	it('sets its field, leaves the rest, and is refused from an old page', () => {
		const before = form();
		expect(patch({ notes: 'Knees out' }, { notes: '' })).toHaveProperty('form');
		expect({ ...form(), notes: '' }).toEqual(before);
		expect(patch({ notes: 'Other' }, { notes: '' })).toMatchObject({ moved: { notes: 'Knees out' } });
		expect(patch({ name: 'x' }, { name: before.name }, {}, other)).toMatchObject({ status: 404 });
		expect(patch({ name: '' }, { name: before.name })).toHaveProperty('error');
		expect(form().name).toBe(before.name);
	});

	it('asks what a unit change does to what is logged', () => {
		const lb = form().metrics.map((m) => ({ ...m, unit: 'lb' }));
		expect(patch({ metrics: lb }, { metrics: form().metrics })).toHaveProperty('error');
		expect(weights()).toEqual([100, 102.5]);
	});

	it('takes a conversion back exactly, and keeps a value corrected since', () => {
		const lb = form().metrics.map((m) => ({ ...m, unit: 'lb' }));
		const r = patch({ metrics: lb }, { metrics: form().metrics }, { units: { [w]: 'convert' }, keep: true }) as { undo: string };
		expect(weights()[0]).toBeCloseTo(220.46, 1);
		const second = db.select().from(entry).where(eq(entry.taskId, id)).all()[1];
		db.update(entry).set({ values: { [w]: 230 } }).where(eq(entry.id, second.id)).run();
		expect(restoreTaskSnapshot(other, r.undo)).toBe(false);
		expect(restoreTaskSnapshot(me, r.undo)).toBe(true);
		expect(form().metrics[0].unit).toBe('kg');
		expect(weights()).toEqual([100, 230]);
		expect(db.select().from(slot).where(eq(slot.id, slotId)).get()?.targets).toEqual({ [w]: 100 });
	});

	it('brings back a field with logs, and the targets set on it', () => {
		const r = patch({ metrics: [] }, { metrics: form().metrics }, { keep: true }) as { undo: string };
		expect(form().metrics).toEqual([]);
		expect(db.select().from(slot).where(eq(slot.id, slotId)).get()?.targets ?? {}).toEqual({});
		expect(restoreTaskSnapshot(me, r.undo)).toBe(true);
		expect(form().metrics.map((m) => m.id)).toEqual([w]);
		expect(db.select().from(slot).where(eq(slot.id, slotId)).get()?.targets).toEqual({ [w]: 100 });
		expect(restoreTaskSnapshot(me, r.undo)).toBe(false);
	});

	it('a field that came with it and was logged in since is kept for its logs', () => {
		const [old] = form().metrics;
		const added = { ...old, id: crypto.randomUUID(), name: 'Effort' };
		const unused = { ...old, id: crypto.randomUUID(), name: 'Never used' };
		const r = patch({ metrics: [added, unused] }, { metrics: form().metrics }, { keep: true }) as { undo: string };
		const e = db.select().from(entry).where(eq(entry.taskId, id)).get()!;
		db.update(entry).set({ values: { ...e.values, [added.id]: 8 } }).where(eq(entry.id, e.id)).run();
		expect(restoreTaskSnapshot(me, r.undo)).toBe(true);
		expect(form().metrics.map((m) => m.id)).toEqual([w]);
		const left = db.select().from(metric).where(eq(metric.taskId, id)).all();
		expect(left.find((m) => m.id === added.id)?.archived).toBe(true);
		expect(left.some((m) => m.id === unused.id)).toBe(false);
		expect(db.select().from(entry).where(eq(entry.id, e.id)).get()!.values[added.id]).toBe(8);
	});

	it('is not taken back over a later change', () => {
		const r = patch({ metrics: [] }, { metrics: form().metrics }, { keep: true }) as { undo: string };
		patch({ name: `Later ${w}` }, { name: form().name });
		expect(restoreTaskSnapshot(me, r.undo)).toBe(false);
		expect(form().metrics).toEqual([]);
	});
});
