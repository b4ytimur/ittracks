// Round 3 fixes against a real (in-memory) database: partial days, the "only the full target
// counts" switch, schedule edits that keep past days, and the one-time restore of partial days.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { entry, habit, occurrence } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { restorePartialDays, settleAll, userToday } from './today';
import { addTemplate } from './repo/templates';
import { getHabitForm, saveHabit } from './repo/habits';
import { startFrom } from './backfill';
import { galleryItem } from '$lib/gallery';
import { addDays } from '$lib/engine/dates';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';

let me: string;
let app: Actor;
let today: string;

const add = (slug: string, answers: Record<string, number | string | number[]> = {}) => {
	const r = addTemplate(me, galleryItem(slug)!.template, { today, answers });
	if ('error' in r) throw new Error(r.error);
	return r.habitId;
};
const run = (name: string, input: unknown = {}) => runAction(app, name, input) as Record<string, unknown>;
const rowOn = (habitId: string, date: string) =>
	db.select().from(occurrence).where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, date))).get();
const entriesOf = (occId: string) => db.select().from(entry).where(eq(entry.occurrenceId, occId)).all();
/** Pretend the habit started `days` ago ("Started on"), with nothing settled yet. */
const startedAgo = (id: string, days: number) => startFrom(db.select().from(habit).where(eq(habit.id, id)).get()!, addDays(today, -days));

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('round3', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
	app = appActor(me);
});

describe('partial days', () => {
	it('a past day with part of the target counts as done when the habit has no Minimum, and keeps its values', () => {
		const water = add('drink-water', { glasses: 6 });
		startedAgo(water, 5);
		const y = addDays(today, -1);
		run('log_value', { habit: water, date: y, value: 5, finish: 'no' });
		settleAll(me, today);
		const o = rowOn(water, y)!;
		expect(o.status).toBe('done');
		expect(entriesOf(o.id).length).toBeGreaterThan(0);
	});

	it('"Only the full target counts": a short past day is missed, values kept; today stays open', () => {
		const water = add('drink-water', { glasses: 6 });
		startedAgo(water, 5);
		db.update(habit).set({ minimumCounts: false }).where(eq(habit.id, water)).run();
		const d = addDays(today, -2);
		run('log_value', { habit: water, date: d, value: 3, finish: 'yes' });
		const past = rowOn(water, d)!;
		expect(past.status).toBe('missed');
		expect(entriesOf(past.id).length).toBeGreaterThan(0);
		run('log_value', { habit: water, value: 3, finish: 'yes' });
		expect(rowOn(water, today)!.status).toBe('due');
		run('log_value', { habit: water, value: 3 });
		expect(rowOn(water, today)!.status).toBe('done');
	});

	it('turning the switch on judges past days again', () => {
		const water = add('drink-water', { glasses: 6 });
		startedAgo(water, 5);
		const f = getHabitForm(me, water)!;
		saveHabit(me, water, { ...f, minimumCounts: false }, today);
		const d = addDays(today, -3);
		run('log_value', { habit: water, date: d, value: 2, finish: 'yes' });
		expect(rowOn(water, d)!.status).toBe('missed');
		saveHabit(me, water, { ...getHabitForm(me, water)!, minimumCounts: true }, today);
		expect(rowOn(water, d)!.status).toBe('done');
	});

	it('the one-time restore brings back partial days that were settled as missed', () => {
		const water = add('drink-water', { glasses: 6 });
		startedAgo(water, 5);
		const d = addDays(today, -4);
		run('log_value', { habit: water, date: d, value: 2, finish: 'no' });
		settleAll(me, today);
		const o = rowOn(water, d)!;
		// What the old rule left behind.
		db.update(occurrence).set({ status: 'missed' }).where(eq(occurrence.id, o.id)).run();
		expect(restorePartialDays()).toBeGreaterThanOrEqual(1);
		expect(rowOn(water, d)!.status).toBe('done');
		// Untouched missed days (nothing logged) stay missed.
		expect(rowOn(water, addDays(today, -3))!.status).toBe('missed');
	});
});

describe('schedule edits', () => {
	/** A daily habit started 14 days ago, settled, with every past day missed. */
	const missedDaily = () => {
		const read = add('reading', { pages: 10 });
		startedAgo(read, 14);
		settleAll(me, today);
		return read;
	};
	const missed = (id: string) =>
		db.select().from(occurrence).where(and(eq(occurrence.habitId, id), eq(occurrence.status, 'missed'))).all().length;
	const weekly = (id: string) => {
		const f = getHabitForm(me, id)!;
		return { ...f, schedule: { kind: 'weekly' as const, days: { '0': f.variants[0].id } } };
	};

	it('"From today on" keeps the misses past days already have', () => {
		const read = missedDaily();
		const before = missed(read);
		expect(before).toBe(14);
		saveHabit(me, read, weekly(read), today, { scheduleApplies: 'today' });
		settleAll(me, today);
		expect(missed(read)).toBe(before);
		const h = db.select().from(habit).where(eq(habit.id, read)).get()!;
		expect(h.earlierSchedules?.at(-1)?.until).toBe(addDays(today, -1));
	});

	it('"Past days too" counts past days again by the new schedule', () => {
		const read = missedDaily();
		saveHabit(me, read, weekly(read), today, { scheduleApplies: 'past' });
		settleAll(me, today);
		// Mondays only: two of the last 14 days.
		expect(missed(read)).toBe(2);
	});
});
