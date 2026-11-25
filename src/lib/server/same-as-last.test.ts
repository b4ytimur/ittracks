// "Same as last" against a real (in-memory) database: it repeats only what the last log holds,
// never a day that came after, is the usual way only when there is something to repeat, and its
// Undo takes back what it wrote, also after a reload.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from './db';
import { entry, occurrence } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { canRepeat, loadToday, sameAsLast, userToday } from './today';
import { saveHabit } from './repo/habits';
import { saveTask } from './repo/tasks';
import { habitForm, taskForm, type PartForm } from '$lib/forms';
import { addDays } from '$lib/engine/dates';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';
import { doneOcc, reopenOcc, undoClears } from './core/log';

let me: string;
let app: Actor;
let today: string;

const run = (name: string, input: unknown = {}) => runAction(app, name, input) as Record<string, unknown>;

function libTask(name: string, field: { name: string; type: 'count' | 'duration' } | null, parts: PartForm[] = []) {
	const metricId = randomUUID();
	const id = saveTask(
		me,
		null,
		taskForm.parse({
			name,
			restTimerEnabled: false,
			restTimerSeconds: 90,
			tags: [],
			metrics: field ? [{ id: metricId, name: field.name, type: field.type, repeats: false }] : [],
			parts
		})
	)!;
	return { id, metricId };
}
const step = (name: string): PartForm => ({ kind: 'step', id: randomUUID(), name });
const inside = (taskId: string, targets: Record<string, number> = {}): PartForm => ({
	kind: 'task',
	id: randomUUID(),
	taskId,
	sets: null,
	targets,
	minTargets: {},
	stretchTargets: {}
});

function dailyWith(name: string, taskId: string, ago = 6): { id: string; variantId: string } {
	const v = randomUUID();
	const start = addDays(today, -ago);
	const id = saveHabit(
		me,
		null,
		habitForm.parse({
			name,
			direction: 'build',
			startDate: start,
			variants: [{ id: v, name: 'Main', slots: [{ id: randomUUID(), taskId, fillRule: null, sets: null }] }],
			schedule: { kind: 'interval', every: 1, start, variantId: v }
		}),
		today
	)!;
	return { id, variantId: v };
}
const occOn = (habitId: string, date: string) =>
	db.select().from(occurrence).where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, date))).get()!;
const entriesOf = (occId: string) => db.select().from(entry).where(eq(entry.occurrenceId, occId)).orderBy(asc(entry.sortOrder)).all();

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('same', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
	app = appActor(me);
});

describe('Same as last', () => {
	it('leaves a place empty that the last log left empty, instead of filling in its targets', () => {
		const scales = libTask('Scales 1', { name: 'Takes', type: 'count' });
		const song = libTask('Song 1', { name: 'Minutes', type: 'duration' });
		const guitar = libTask('Guitar 1', null, [inside(scales.id, { [scales.metricId]: 3 }), inside(song.id, { [song.metricId]: 20 })]);
		const h = dailyWith('Guitar', guitar.id);
		const y = addDays(today, -1);
		run('log_task', { habit: h.id, date: y, task: 'Guitar 1 › Song 1', values: { Minutes: 10 }, finish: 'yes' });
		loadToday(me, today);
		const occ = occOn(h.id, today);
		expect(sameAsLast(occ.id)).toBe('done');
		const es = entriesOf(occ.id);
		expect(es.filter((e) => e.taskId === song.id).map((e) => e.values[song.metricId])).toEqual([10]);
		expect(es.filter((e) => e.taskId === scales.id)).toEqual([]);
	});

	it('on a past day copies only from before it, never from a day logged after', () => {
		const sheet = libTask('Sheet 2', { name: 'Minutes', type: 'duration' });
		const block = libTask('Block 2', null, [inside(sheet.id, { [sheet.metricId]: 50 })]);
		const h = dailyWith('Study', block.id);
		run('log_task', { habit: h.id, date: addDays(today, -2), task: 'Block 2 › Sheet 2', values: { Minutes: 60 }, finish: 'yes' });
		const early = addDays(today, -4);
		expect(canRepeat(h.id, { id: null, date: early, variantId: h.variantId })).toBe(false);
		expect(canRepeat(h.id, { id: null, date: addDays(today, -1), variantId: h.variantId })).toBe(true);
	});

	it('is the usual way for values or one tick, not for a list of ticked steps', () => {
		const doses = libTask('Doses 3', null, [step('Morning dose'), step('Evening dose')]);
		const pills = dailyWith('Antibiotic', doses.id);
		const y = addDays(today, -1);
		run('log_task', { habit: pills.id, date: y, task: 'Doses 3', ticks: ['Morning dose', 'Evening dose'], finish: 'yes' });
		expect(occOn(pills.id, y).status).toBe('done');
		expect(canRepeat(pills.id, { id: null, date: today, variantId: pills.variantId })).toBe(false);

		// One Yes or no Task: its one tick is worth repeating.
		const once = libTask('Vitamin 3', null);
		const vit = dailyWith('Vitamin', once.id);
		loadToday(me, today);
		expect(doneOcc(app, occOn(vit.id, today), 'targets', null)).toBe('done');
		expect(entriesOf(occOn(vit.id, today).id).map((e) => e.values)).toEqual([{ done: true }]);
		expect(canRepeat(vit.id, { id: null, date: addDays(today, 1), variantId: vit.variantId })).toBe(true);
	});

	it('Undo with no word on it takes back what one tap wrote, and keeps a log saved after', () => {
		const read = libTask('Read 4', { name: 'Pages', type: 'count' });
		const h = dailyWith('Reading', read.id);
		run('log_task', { habit: h.id, date: addDays(today, -1), task: 'Read 4', values: { Pages: 12 }, finish: 'yes' });
		loadToday(me, today);
		let occ = occOn(h.id, today);
		expect(doneOcc(app, occ, 'same', null)).toBe('done');
		occ = occOn(h.id, today);
		expect(entriesOf(occ.id)).toHaveLength(1);
		expect(undoClears(app, occ)).toBe(true);
		reopenOcc(app, occ, undoClears(app, occ));
		expect(entriesOf(occ.id)).toEqual([]);

		// Logged by hand first: Same as last keeps that, so Undo keeps it too.
		run('log_task', { habit: h.id, task: 'Read 4', values: { Pages: 30 } });
		occ = occOn(h.id, today);
		doneOcc(app, occ, 'same', null);
		expect(undoClears(app, occOn(h.id, today))).toBe(false);
	});
});
