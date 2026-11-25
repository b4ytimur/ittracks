// A routine's Done and the times of the habits inside it: one whose time today is
// still ahead, by its cue time or its part of the day, stays due, and the Done says so. A past
// day's times have all come, so its Done marks them all.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { occurrence } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { loadToday, settleAll, userToday } from './today';
import { saveHabit } from './repo/habits';
import { habitForm } from '$lib/forms';
import { addDays } from '$lib/engine/dates';
import { cueClock, stillAhead } from '$lib/engine/day';
import { leftText } from '$lib/engine/rollup';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';
import { doneOcc, leftOpen } from './core/log';

let me: string;
let app: Actor;
let today: string;
const d = (n: number) => addDays(today, n);
const at = (clock: string) => vi.setSystemTime(new Date(`${today}T${clock}:00Z`));
const run = (name: string, input: unknown = {}) => runAction(app, name, input) as Record<string, unknown>;
const occOf = (habitId: string, date = today) => db.select().from(occurrence).where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, date))).get()!;
const statuses = (ids: string[], date = today) => ids.map((id) => occOf(id, date)?.status ?? null);
const save = (f: unknown) => saveHabit(me, null, habitForm.parse(f), today)!;

function routine(name: string, ago = 0) {
	const v = randomUUID();
	const start = d(-ago);
	return save({ name, direction: 'build', startDate: start, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'interval', every: 1, start, variantId: v } });
}
function inside(name: string, parentId: string, cue: Record<string, string> = {}, ago = 0) {
	const v = randomUUID();
	return save({ name, direction: 'build', startDate: d(-ago), cue, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'follow', variantId: v, on: null }, parentId });
}

beforeAll(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-11-25T05:00:00Z'));
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('routinetimes', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00', ranges: [{ name: 'Evening', start: '17:00', end: '22:00' }] });
	today = userToday(me);
	app = appActor(me);
});
afterAll(() => {
	vi.useRealTimers();
});

describe('the times of the habits inside a routine', () => {
	it('a time or part of the day still ahead: Done leaves it due, and says so', () => {
		at('05:00');
		const r = routine('Evening medicines');
		const pill = inside('Evening Lisinopril', r, { time: '20:00' });
		const walk = inside('Evening walk', r, { range: 'Evening' });
		const symptoms = inside('Symptoms', r);
		loadToday(me, today);
		expect(doneOcc(app, occOf(r), 'mark', null)).toBe('needsInput');
		expect(statuses([pill, walk, symptoms, r])).toEqual(['due', 'due', 'done', 'due']);
		const left = leftOpen(app, occOf(r));
		expect(left).toEqual([
			{ habit: 'Evening Lisinopril', at: '20:00' },
			{ habit: 'Evening walk', at: '17:00' }
		]);
		expect(leftText(left)).toBe('Evening Lisinopril waits for 20:00. Evening walk waits for 17:00.');
	});

	it('once the time has come, Done marks it too', () => {
		at('06:00');
		const r = routine('Morning medicines');
		const pill = inside('Morning pill', r, { time: '07:30' });
		loadToday(me, today);
		const early = run('log_done', { habit: r });
		expect(early).toMatchObject({ status: 'due', left: [{ habit: 'Morning pill', at: '07:30' }] });
		at('07:45');
		expect(run('log_done', { habit: r })).toMatchObject({ status: 'done' });
		expect(statuses([pill, r])).toEqual(['done', 'done']);
		at('05:00');
	});

	it("a past day's times have all come: its Done marks every habit inside", () => {
		at('05:00');
		const r = routine('Night routine', 3);
		const pill = inside('Night pill', r, { time: '22:00' }, 3);
		settleAll(me, today);
		expect(run('log_done', { habit: r, date: d(-1) })).toMatchObject({ status: 'done' });
		expect(statuses([pill, r], d(-1))).toEqual(['done', 'done']);
	});

	it('times are read in the order the day is lived', () => {
		expect(cueClock({ time: null, range: 'Evening' }, [{ name: 'Evening', start: '17:00', end: '22:00' }])).toBe('17:00');
		expect(cueClock({ time: '08:00', range: 'Evening' }, [])).toBe('08:00');
		expect(cueClock({ range: 'Nowhere' }, [])).toBeNull();
		// With the day starting at 04:00, 01:00 is still ahead at 23:00, and 23:00 has passed at 01:00.
		expect(stillAhead('01:00', '23:00', '04:00')).toBe(true);
		expect(stillAhead('23:00', '01:00', '04:00')).toBe(false);
		expect(leftText([{ habit: 'Blood pressure', at: null }, { habit: 'Weight', at: null }])).toBe('Blood pressure and Weight need values filled in before they count.');
	});
});
