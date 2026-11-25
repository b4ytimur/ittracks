import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { habit, metric, slot, task, variant } from './db/schema';
import { createAccount } from './auth';
import { startHabit, unstart } from './start';
import { getSettings, getUnits, saveSettings } from './settings';
import { getHabitForm } from './repo/habits';
import { readHabit } from '$lib/say/read';

let me: string;
let n = 0;
const today = '2026-11-25';
beforeAll(() => migrate(db, { migrationsFolder: './drizzle' }));
beforeEach(async () => {
	me = await createAccount(`start-${n++}`, 'correct horse battery');
});
const start = (text: string) => {
	const r = startHabit(me, readHabit(text, getUnits(me)), today);
	if ('error' in r) throw new Error(r.error);
	return r;
};

describe('a habit from its sentence', () => {
	it('takes anything, with no pack and no setting', () => {
		const r = start('3 ducks every day');
		const f = getHabitForm(me, r.habit)!;
		expect(f.schedule).toMatchObject({ kind: 'interval', every: 1, start: today });
		const m = db.select().from(metric).where(eq(metric.taskId, r.task!)).get()!;
		expect([m.name, m.type, m.unit]).toEqual(['Ducks', 'count', 'ducks']);
		const s = db.select().from(slot).innerJoin(variant, eq(slot.variantId, variant.id)).where(eq(variant.habitId, r.habit)).get()!;
		expect(s.slot.targets).toEqual({ [m.id]: 3 });
	});
	it('a time is a duration, and a part of the day is made when it is first used', () => {
		expect(getSettings(me).ranges).toEqual([]);
		const r = start('meditate every morning 15 min');
		expect(db.select().from(metric).where(eq(metric.taskId, r.task!)).get()!.type).toBe('duration');
		expect(getSettings(me).ranges.map((x) => x.name)).toEqual(['Morning']);
		expect(getHabitForm(me, r.habit)!.cue.range).toBe('Morning');
		start('floss in the morning');
		expect(getSettings(me).ranges).toHaveLength(1);
	});
	it('a part whose hours are taken becomes a time', () => {
		saveSettings(me, { ranges: [{ name: 'Early', start: '04:00', end: '09:00' }] });
		const r = start('meditate in the morning');
		expect(getHabitForm(me, r.habit)!.cue).toMatchObject({ range: null, time: '05:00' });
		expect(getSettings(me).ranges).toHaveLength(1);
	});
	it('named days, times a week, and something to stop', () => {
		expect(Object.keys((getHabitForm(me, start('piano on Mon, Wed and Fri').habit)!.schedule as { days: object }).days)).toEqual(['0', '2', '4']);
		expect(getHabitForm(me, start('gym 3x a week').habit)!.schedule).toMatchObject({ kind: 'frequency', times: 3, period: 'week' });
		expect(getHabitForm(me, start('stop smoking').habit)).toMatchObject({ direction: 'break', name: 'Smoking' });
	});
	it('its Undo takes the habit and its Task back', () => {
		const r = start('read 10 pages');
		expect(unstart(me, r.habit, r.task, today)).toBe(true);
		expect(db.select().from(habit).where(eq(habit.id, r.habit)).get()!.deleteAfter).not.toBeNull();
		expect(db.select().from(task).where(eq(task.id, r.task!)).get()!.deleteAfter).not.toBeNull();
	});
	it('refuses nothing said', () => {
		expect(startHabit(me, readHabit('', getUnits(me)), today)).toHaveProperty('error');
	});
});
