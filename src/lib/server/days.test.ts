// The days block's counts against a real (in-memory) database: what a day counts as History counts it, one habit's own
// rows when it is the one counted, and only the days a page can show.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { occurrence } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { loadToday, settleAll, userToday } from './today';
import { archiveHabit } from './habit-actions';
import { saveHabit } from './repo/habits';
import { dayCounts, dayHabits, daysData, firstDay } from './days';
import { habitForm } from '$lib/forms';
import { addDays, daysBetween } from '$lib/engine/dates';
import { countedRows, statusCount, yearStart } from '$lib/days/days';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';

let me: string;
let app: Actor;
let today: string;

const run = (name: string, input: unknown = {}) => runAction(app, name, input) as Record<string, unknown>;
const rowOn = (habitId: string, date: string) => db.select().from(occurrence).where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, date))).get();
const d = (n: number) => addDays(today, n);

/** A new account for each case, so their days never mix. */
async function fresh(name: string) {
	me = await createAccount(`days-${name}`, 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	app = appActor(me);
	today = userToday(me);
}
/** A tick-off habit due every `every` days from `ago` days back. */
function habitEvery(name: string, every: number, ago: number): string {
	const v = randomUUID();
	return saveHabit(me, null, habitForm.parse({ name, direction: 'build', startDate: d(-ago), variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'interval', every, start: d(-ago), variantId: v } }), today)!;
}
function follower(name: string, parentId: string, ago: number): string {
	const v = randomUUID();
	return saveHabit(me, null, habitForm.parse({ name, direction: 'build', startDate: d(-ago), variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'follow', variantId: v, on: null }, parentId }), today)!;
}

beforeAll(() => {
	migrate(db, { migrationsFolder: './drizzle' });
});

describe('a day in the days block', () => {
	it('counts the last 12 months and the days round a day long ago, never every day between', async () => {
		await fresh('cap');
		habitEvery('Read', 1, 3);
		const year = daysBetween(yearStart(today), today) + 1;
		const week = Object.keys(daysData(me, today, { show: 'week', habit: null }, '2000-01-05').counts);
		expect(week).toHaveLength(year + 7);
		expect(week).toContain('2000-01-05');
		expect(week).not.toContain('2000-01-10');
		// A month: the month and the week its day is in, from the first of them to the last.
		const month = Object.keys(daysData(me, today, { show: 'month', habit: null }, '2000-01-01').counts);
		expect(month).toHaveLength(year + daysBetween('1999-12-27', '2000-01-31') + 1);
		expect(month).toContain('2000-01-31');
		// The 12 months: the week its day is in, and nothing between.
		const twelve = Object.keys(daysData(me, today, { show: 'year', habit: null }, '2000-01-05').counts);
		expect(twelve).toHaveLength(year + 7);
		expect(twelve).not.toContain('2000-01-10');
		expect(Object.keys(daysData(me, today, { show: 'week', habit: null }).counts)).toHaveLength(year);
	});

	it('a log on a day off changes nothing, as History counts it', async () => {
		await fresh('extra');
		habitEvery('Read', 1, 3);
		habitEvery('Walk', 1, 3);
		const stretch = habitEvery('Stretch', 2, 3); // due 3 and 1 days back: 2 days back is a day off
		settleAll(me, today);
		run('log_done', { habit: stretch, date: d(-2), extra: true });
		expect(rowOn(stretch, d(-2))).toMatchObject({ status: 'done', extra: true });
		expect(dayCounts(me, d(-2), d(-2))[d(-2)]).toEqual([0, 2]);
	});

	it('Today counts today as the server counts it: a log on a day off shows, and counts for nothing', async () => {
		await fresh('extra-today');
		habitEvery('Read', 1, 3);
		const stretch = habitEvery('Stretch', 2, 1); // due yesterday and tomorrow: today is a day off
		settleAll(me, today);
		run('log_done', { habit: stretch, date: today, extra: true });
		const { build } = loadToday(me, today);
		expect(build.map((b) => b.name).sort()).toEqual(['Read', 'Stretch']);
		expect(statusCount(countedRows(build).map((b) => b.occurrence!.status))).toEqual(dayCounts(me, today, today)[today]);
		expect(dayCounts(me, today, today)[today]).toEqual([0, 1]);
	});

	it("an archived habit's day left open never comes due; its days before still count", async () => {
		await fresh('archived');
		habitEvery('Stay', 1, 1);
		const gone = habitEvery('Gone', 1, 1);
		settleAll(me, today);
		loadToday(me, today);
		archiveHabit(me, gone, today);
		expect(rowOn(gone, today)?.status).toBe('due');
		expect(dayCounts(me, today, today)[today]).toEqual([0, 1]);
		expect(dayCounts(me, d(-1), d(-1))[d(-1)]).toEqual([0, 2]);
		settleAll(me, d(1));
		expect(dayCounts(me, today, today)[today]).toEqual([0, 1]);
	});

	it('counts a routine on its own day when it is the one habit counted', async () => {
		await fresh('routine');
		const bedtime = habitEvery('Bedtime', 1, 3);
		follower('Floss', bedtime, 3);
		follower('Read', bedtime, 3);
		run('log_done', { habit: bedtime, date: d(-2) });
		settleAll(me, today);
		expect(rowOn(bedtime, d(-2))).toMatchObject({ status: 'done', rollup: { done: 2, total: 2 } });
		expect(dayHabits(me).map((h) => h.name)).toEqual(['Bedtime', 'Floss', 'Read']);
		const c = dayCounts(me, d(-3), d(-1), bedtime);
		expect([c[d(-3)], c[d(-2)], c[d(-1)]]).toEqual([
			[0, 1],
			[1, 1],
			[0, 1]
		]);
		// Every habit: the routine counts through the habits inside it.
		expect(dayCounts(me, d(-2), d(-2))[d(-2)]).toEqual([2, 2]);
		expect(firstDay(me)).toBe(d(-3));
	});
});
