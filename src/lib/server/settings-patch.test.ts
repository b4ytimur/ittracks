// One line of the settings at a time: every rule still holds, an old page never overwrites, and
// what a change says it did is exactly what its Undo puts back.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { habit, settings } from './db/schema';
import { createAccount } from './auth';
import { saveHabit } from './repo/habits';
import { getSettings, saveSettings, type Settings } from './settings';
import { patchSettings, type SettingsSet } from './settings-patch';
import { habitForm } from '$lib/forms';
import type { DayRange } from '$lib/engine/day';
import { saveTask } from './repo/tasks';
import { taskForm } from '$lib/forms';
import { metric } from './db/schema';
import { getKinds, getUnits } from './settings';
import { metricsFromType } from '$lib/task-types';
import { STARTER, STARTER_KINDS } from '$lib/units';

let me: string;
const now = () => getSettings(me);
const patch = (set: Record<string, unknown>, was: Record<string, unknown>, renames = {}, unitRenames = {}) => patchSettings(me, { set, was, renames, unitRenames });
const undo = (r: ReturnType<typeof patch>) => {
	if (!('now' in r)) throw new Error(JSON.stringify(r));
	const back = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([a, b]) => [b, a]));
	return patch(r.was, r.now, back(r.renames), back(r.unitRenames));
};
const morning: DayRange = { name: 'Morning', start: '05:00', end: '11:00' };
const evening: DayRange = { name: 'Evening', start: '17:00', end: '22:00' };

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('settings-patch', 'correct horse battery');
});
beforeEach(() => {
	db.delete(settings).where(eq(settings.accountId, me)).run();
	saveSettings(me, { ranges: [morning, evening] });
});

describe('a line of the settings', () => {
	it('sets its fields, leaves the rest, and its Undo is exact', () => {
		const before = now();
		const r = patch({ pastDays: 7, dayNote: true }, { pastDays: null, dayNote: false });
		expect(now()).toEqual({ ...before, pastDays: 7, dayNote: true });
		undo(r);
		expect(now()).toEqual(before);
	});
	it('a day start that was never set goes back to not set', () => {
		const r = patch({ dayStart: '04:00' }, { dayStart: null });
		expect(now().dayStart).toBe('04:00');
		undo(r);
		expect(now().dayStart).toBeUndefined();
	});
	it('is refused when the field changed since, and only then', () => {
		patch({ pastDays: 7 }, { pastDays: null });
		expect(patch({ pastDays: 3 }, { pastDays: null })).toEqual({ moved: ['pastDays'] });
		expect(now().pastDays).toBe(7);
		expect(patch({ dayNote: true }, { dayNote: false })).toHaveProperty('now');
		expect(patch({ pastDays: 7 }, { pastDays: null })).toHaveProperty('now');
	});
	it('turning off past days takes the nudge with it, and Undo brings it back', () => {
		const r = patch({ pastDays: 0 }, { pastDays: null });
		expect(now()).toMatchObject({ pastDays: 0, nudgeYesterday: false });
		undo(r);
		expect(now()).toMatchObject({ pastDays: null, nudgeYesterday: true });
	});
	it.each<[string, Record<string, unknown>, string]>([
		['overlapping parts', { ranges: [morning, { ...evening, start: '10:00' }] }, "Parts of the day can't overlap"],
		['a part of no length', { ranges: [{ ...morning, end: '05:00' }] }, 'A part of the day must end at a different time than it starts'],
		['two parts of one name', { ranges: [morning, { ...evening, name: 'morning' }] }, 'Two parts of the day are called “morning”. Give each its own name.'],
		['a part with no name', { ranges: [{ ...morning, name: ' ' }] }, 'Give each part of the day a name'],
		['no time', { dayStart: '4' }, 'Pick a time like 04:00'],
		['a bad limit', { pastDays: -1 }, 'Pick how many days back can be logged'],
		['a unit in two kinds', { units: [...STARTER_KINDS, { id: 'x', name: 'Other', shown: 'kg', units: [{ id: 'x', name: 'kg', per: 1, step: 1 }] }] }, 'Two units are called “kg” (Weight and Other)'],
		['no clocks', { units: STARTER_KINDS.slice(1) }, 'Time keeps s, min and h: the clocks need them'],
		['a unit worth nothing', { units: [...STARTER_KINDS, { id: 'x', name: 'Other', shown: 'q', units: [{ id: 'x', name: 'q', per: 0, step: 1 }] }] }, 'One of it must be more than nothing'],
		['a field that is not a setting', { pinned: [] }, '']
	])('refuses %s and changes nothing', (_, set, why) => {
		const before = now();
		const r = patch(set, Object.fromEntries(Object.keys(set).map((k) => [k, k === 'units' ? getKinds(me) : (before[k as keyof Settings] ?? null)])));
		expect(r).toHaveProperty('error');
		if (why) expect((r as { error: string }).error).toBe(why);
		expect(now()).toEqual(before);
	});
	it("a renamed part keeps its habits, also through its Undo; a removed one leaves them on its name", () => {
		const v = crypto.randomUUID();
		const id = saveHabit(me, null, habitForm.parse({ name: 'Read', direction: 'build', startDate: '2026-11-01', cue: { range: 'Morning' }, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'interval', every: 1, start: '2026-11-01', variantId: v } }), '2026-11-22')!;
		const part = () => db.select().from(habit).where(eq(habit.id, id)).get()!.cue?.range;
		const set: SettingsSet = { ranges: [{ ...morning, name: 'Dawn' }, evening] };
		const r = patch(set, { ranges: [morning, evening] }, { Morning: 'Dawn' });
		expect(part()).toBe('Dawn');
		undo(r);
		expect(part()).toBe('Morning');
		const gone = patch({ ranges: [evening] }, { ranges: [morning, evening] });
		expect(part()).toBe('Morning');
		undo(gone);
		expect(now().ranges).toEqual([morning, evening]);
		// A rename to a part that isn't there moves nothing.
		patch({ ranges: [evening] }, { ranges: [morning, evening] }, { Morning: 'Nowhere' });
		expect(part()).toBe('Morning');
	});
	it('a renamed unit keeps its fields and what it converts to, also through its Undo', () => {
		const id = saveTask(me, null, taskForm.parse({ name: 'Press', restTimerEnabled: false, restTimerSeconds: 90, tags: [], parts: [], metrics: metricsFromType({ key: 'x', name: 'x', description: '', restTimerEnabled: false, metrics: ['lb', 'lbs'].map((unit) => ({ name: `In ${unit}`, type: 'number' as const, unit, repeats: true, step: null })) }, STARTER) }))!;
		const other = () => db.select({ unit: metric.unit }).from(metric).where(eq(metric.taskId, id)).all().map((m) => m.unit);
		const before = other();
		const kinds = STARTER_KINDS.map((k) => ({ ...k, units: k.units.map((x) => (x.name === 'lb' ? { ...x, name: 'pound', also: ['lbs', 'lb'] } : x)) }));
		const r = patch({ units: kinds }, { units: getKinds(me) }, {}, { lb: 'pound' });
		expect(r).toHaveProperty('now');
		expect(other().sort()).toEqual(['lbs', 'pound']);
		for (const w of ['pound', 'lbs', 'lb']) expect(getUnits(me).factor(w, 'kg')).toBeCloseTo(0.45359237, 9);
		undo(r);
		expect(other()).toEqual(before);
		expect(getKinds(me)).toEqual(STARTER_KINDS);
		// A rename to a word that is no unit moves nothing.
		patch({ units: kinds }, { units: getKinds(me) }, {}, { kg: 'nowhere' });
		expect(getUnits(me).find('kg')).not.toBeNull();
	});
	it('the weight unit picked before units were stored is what Weight is shown in', () => {
		saveSettings(me, { weightUnit: 'lbs' });
		expect(getUnits(me).shown('weight')).toBe('lb');
		const r = patch({ units: getKinds(me).map((k) => (k.id === 'weight' ? { ...k, shown: 'kg' } : k)) }, { units: getKinds(me) });
		expect(getUnits(me).shown('weight')).toBe('kg');
		undo(r);
		expect(getUnits(me).shown('weight')).toBe('lb');
	});
});
