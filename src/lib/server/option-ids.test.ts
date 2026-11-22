// Choice options and slip feelings with stable ids, against a real (in-memory) database: a rename
// shows in past logs, an option a log used is archived when removed, a changed number keeps the
// old one for past days, the API takes options by name, and rows from before ids are upgraded.
import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { entry, habit, metric, occurrence, slip } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { userToday } from './today';
import { getTaskForm, saveTask } from './repo/tasks';
import { getHabitForm, saveHabit } from './repo/habits';
import { upgradeOptionIds } from './db/upgrade';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';
import { habitForm, taskForm } from '$lib/forms';
import { checkTask } from '$lib/rules/task';
import { addDays } from '$lib/engine/dates';
import type { ChoiceOption } from '$lib/options';

let me: string;
let app: Actor;
let today: string;

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('options', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
	app = appActor(me);
});

const run = (name: string, input: unknown = {}) => runAction(app, name, input) as Record<string, unknown>;
type ValueRow = { ref: string; date: string; field: string; value: unknown; score: number | null };
const values = (habitName: string) => (run('values', { habits: [habitName], fields: ['Mood'], days: 30 }).rows as ValueRow[]).sort((a, b) => a.date.localeCompare(b.date));
const choicesOf = (metricId: string) => db.select({ choices: metric.choices, scores: metric.scores, earlier: metric.earlierScores }).from(metric).where(eq(metric.id, metricId)).get()!;

const everyDay = (variantId: string) => ({ kind: 'weekly' as const, days: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), variantId])) });

/** A break habit, as the editor sends one. */
function breakHabit(name: string) {
	const variant = randomUUID();
	return saveHabit(me, null, habitForm.parse({ name, direction: 'break', startDate: addDays(today, -10), variants: [{ id: variant, name: 'A', slots: [] }], schedule: everyDay(variant) }), today)!;
}

/** A Task with a Mood field (three options, numbered 5, 3 and 1) and a daily habit using it. */
function moodHabit(opts: { scores?: boolean } = { scores: true }) {
	const ids = { mood: randomUUID(), great: randomUUID(), okay: randomUUID(), bad: randomUUID(), variant: randomUUID(), slot: randomUUID() };
	const name = `Mood ${ids.mood.slice(0, 4)}`;
	const taskId = saveTask(
		me,
		null,
		taskForm.parse({
			name,
			restTimerEnabled: false,
			restTimerSeconds: 90,
			tags: [],
			metrics: [
				{
					id: ids.mood,
					name: 'Mood',
					type: 'choice',
					choices: [
						{ id: ids.great, name: 'Great' },
						{ id: ids.okay, name: 'Okay' },
						{ id: ids.bad, name: 'Bad' }
					],
					repeats: false,
					scores: opts.scores ? { [ids.great]: 5, [ids.okay]: 3, [ids.bad]: 1 } : {}
				}
			],
			subtasks: []
		})
	)!;
	const habitId = saveHabit(
		me,
		null,
		habitForm.parse({
			name,
			direction: 'build',
			startDate: addDays(today, -10),
			variants: [{ id: ids.variant, name: 'A', slots: [{ id: ids.slot, taskId, fillRule: null, sets: 1, targets: {} }] }],
			schedule: everyDay(ids.variant)
		}),
		today
	)!;
	return { ...ids, name, taskId, habitId };
}

const form = (taskId: string) => getTaskForm(me, taskId)!;
const editMood = (taskId: string, change: (m: ReturnType<typeof form>['metrics'][number]) => void) => {
	const f = form(taskId);
	change(f.metrics[0]);
	saveTask(me, taskId, f);
};

describe('choice options', () => {
	it('the API logs an option by name and stores its id; an unknown one lists the choices', () => {
		const h = moodHabit();
		const r = run('log_value', { habit: h.name, field: 'mood', value: ' okay ', date: addDays(today, -2) });
		expect(r.value).toBe('Okay');
		const stored = db.select({ values: entry.values }).from(entry).where(eq(entry.taskId, h.taskId)).get()!;
		expect(stored.values[h.mood]).toBe(h.okay);
		run('log_value', { habit: h.name, field: 'Mood', value: h.great, date: addDays(today, -1) });
		expect(() => run('log_value', { habit: h.name, field: 'Mood', value: 'Fine' })).toThrow(/one of: Great, Okay, Bad/);
		expect(values(h.name).map((v) => v.value)).toEqual(['Okay', 'Great']);
	});

	it('a renamed option is renamed in past logs and keeps its number', () => {
		const h = moodHabit();
		run('log_value', { habit: h.name, field: 'Mood', value: 'Okay', date: addDays(today, -1) });
		editMood(h.taskId, (m) => (m.choices.find((c) => c.id === h.okay)!.name = 'Fine'));
		expect(values(h.name)).toMatchObject([{ value: 'Fine', score: 3 }]);
		expect(choicesOf(h.mood).earlier).toBeNull();
	});

	it('removing an option a log used archives it; one no log used is dropped', () => {
		const h = moodHabit();
		run('log_value', { habit: h.name, field: 'Mood', value: 'Bad', date: addDays(today, -1) });
		editMood(h.taskId, (m) => (m.choices = m.choices.filter((c) => c.id === h.great)));
		const saved = choicesOf(h.mood);
		expect(saved.choices).toEqual([
			{ id: h.great, name: 'Great' },
			{ id: h.bad, name: 'Bad', archived: true }
		]);
		// The archived option keeps its number for the days that used it.
		expect(saved.scores).toEqual({ [h.great]: 5, [h.bad]: 1 });
		expect(values(h.name)).toMatchObject([{ value: 'Bad', score: 1 }]);
		// New logs no longer offer it, and the editor no longer shows it.
		expect(() => run('log_value', { habit: h.name, field: 'Mood', value: 'Bad' })).toThrow(/one of: Great\./);
		expect(form(h.taskId).metrics[0].choices).toEqual([{ id: h.great, name: 'Great' }]);
		// Saving again keeps it archived.
		saveTask(me, h.taskId, form(h.taskId));
		expect(choicesOf(h.mood).choices).toHaveLength(2);
	});

	it('a changed number counts from today: past days keep the one they had', () => {
		const h = moodHabit();
		run('log_value', { habit: h.name, field: 'Mood', value: 'Great', date: addDays(today, -1) });
		editMood(h.taskId, (m) => (m.scores = { ...m.scores, [h.great]: 10 }));
		const saved = choicesOf(h.mood);
		expect(saved.earlier).toEqual([{ until: addDays(today, -1), scores: { [h.great]: 5, [h.okay]: 3, [h.bad]: 1 } }]);
		run('log_value', { habit: h.name, field: 'Mood', value: 'Great' });
		expect(values(h.name).map((v) => v.score)).toEqual([5, 10]);
		// A second change on the same day keeps the one earlier set.
		editMood(h.taskId, (m) => (m.scores = { ...m.scores, [h.great]: 9 }));
		expect(choicesOf(h.mood).earlier).toHaveLength(1);
		expect(values(h.name).map((v) => v.score)).toEqual([5, 9]);
	});

	it('the first numbers on a field apply to past days too, and a field with no logs keeps no earlier set', () => {
		const h = moodHabit({ scores: false });
		run('log_value', { habit: h.name, field: 'Mood', value: 'Okay', date: addDays(today, -1) });
		editMood(h.taskId, (m) => (m.scores = { [h.great]: 5, [h.okay]: 3, [h.bad]: 1 }));
		expect(choicesOf(h.mood).earlier).toBeNull();
		expect(values(h.name)).toMatchObject([{ score: 3 }]);
		const fresh = moodHabit();
		editMood(fresh.taskId, (m) => (m.scores = { ...m.scores, [fresh.great]: 7 }));
		expect(choicesOf(fresh.mood).earlier).toBeNull();
	});

	it('two options with one name are refused', () => {
		const h = moodHabit({ scores: false });
		const f = form(h.taskId);
		f.metrics[0].choices.push({ id: randomUUID(), name: ' great' });
		expect(checkTask(f).errors.map((e) => e.reason)).toEqual(['Two options have the same name']);
	});
});

describe('slip feelings', () => {
	function smoking() {
		const name = `Smoking ${randomUUID().slice(0, 4)}`;
		const id = breakHabit(name);
		return { id, name, feelings: () => db.select({ t: habit.triggers }).from(habit).where(eq(habit.id, id)).get()!.t! };
	}
	const feelingsLogged = (name: string) =>
		(run('logs', { habits: [name], status: ['slip'], days: 30 }).rows as { feeling?: string | null }[]).map((r) => r.feeling);

	it('a new break habit starts with the default feelings, and a slip stores the feeling id', () => {
		const h = smoking();
		expect(h.feelings().map((f) => f.name)).toEqual(['Bored', 'Stressed', 'Tired', 'Social', 'After a meal']);
		const s = run('log_slip', { habit: h.name, feeling: 'stressed', date: addDays(today, -1) });
		const stored = db.select({ f: slip.feeling }).from(slip).where(eq(slip.id, s.slipId as string)).get()!;
		expect(stored.f).toBe(h.feelings().find((f) => f.name === 'Stressed')!.id);
		expect(feelingsLogged(h.name)).toEqual(['Stressed']);
		expect(() => run('log_slip', { habit: h.name, feeling: 'Angry' })).toThrow(/feeling is one of: Bored, Stressed/);
	});

	it('a renamed feeling shows in past slips; a removed one a slip used is archived, others dropped', () => {
		const h = smoking();
		run('log_slip', { habit: h.name, feeling: 'Tired', date: addDays(today, -1) });
		const f = getHabitForm(me, h.id)!;
		const tired = f.triggers.find((t) => t.name === 'Tired')!;
		f.triggers = [{ ...tired, name: 'Exhausted' }, ...f.triggers.filter((t) => t.name === 'Bored')];
		saveHabit(me, h.id, f, today);
		expect(feelingsLogged(h.name)).toEqual(['Exhausted']);
		expect(h.feelings().map((t) => t.name)).toEqual(['Exhausted', 'Bored']);
		// Remove the used one: archived, and no longer offered.
		saveHabit(me, h.id, { ...getHabitForm(me, h.id)!, triggers: getHabitForm(me, h.id)!.triggers.filter((t) => t.name === 'Bored') }, today);
		expect(h.feelings()).toEqual([expect.objectContaining({ name: 'Bored' }), { id: tired.id, name: 'Exhausted', archived: true }]);
		expect(getHabitForm(me, h.id)!.triggers.map((t) => t.name)).toEqual(['Bored']);
		expect(feelingsLogged(h.name)).toEqual(['Exhausted']);
		expect(() => run('log_slip', { habit: h.name, feeling: 'Exhausted' })).toThrow(/one of: Bored\./);
	});
});

describe('upgrading rows from before ids', () => {
	it('moves words to ids, keeps words no option has as archived options, and changes nothing the second time', () => {
		const h = moodHabit();
		const occ = randomUUID();
		db.insert(occurrence).values({ id: occ, habitId: h.habitId, variantId: h.variant, date: addDays(today, -3), status: 'done' }).run();
		const words = ['Great', 'okay', 'Meh'];
		for (const [i, w] of words.entries()) db.insert(entry).values({ id: randomUUID(), occurrenceId: occ, taskId: h.taskId, values: { [h.mood]: w }, sortOrder: i }).run();
		// The old shape: options and numbers by word.
		db.update(metric)
			.set({ choices: ['Great', 'Okay', 'Bad'] as unknown as ChoiceOption[], scores: { Great: 5, Okay: 3 } })
			.where(eq(metric.id, h.mood))
			.run();

		const smoke = breakHabit('Old smoking');
		const vape = breakHabit('Old vaping');
		db.update(habit).set({ triggers: null }).where(eq(habit.id, smoke)).run();
		db.update(habit)
			.set({ triggers: ['Bored', 'Angry'] as unknown as ChoiceOption[] })
			.where(eq(habit.id, vape))
			.run();
		const slips = [
			{ habitId: smoke, feeling: 'Stressed' },
			{ habitId: vape, feeling: 'angry' },
			{ habitId: vape, feeling: 'Gone' }
		];
		for (const s of slips) db.insert(slip).values({ id: randomUUID(), habitId: s.habitId, date: addDays(today, -1), feeling: s.feeling }).run();

		const done = db.transaction((tx) => upgradeOptionIds(tx));
		expect(done.metrics).toBeGreaterThanOrEqual(1);
		expect(done.habits).toBeGreaterThanOrEqual(2);

		const m = choicesOf(h.mood);
		const opts = m.choices!;
		expect(opts.map((o) => [o.name, !!o.archived])).toEqual([
			['Great', false],
			['Okay', false],
			['Bad', false],
			['Meh', true]
		]);
		const idOf = (n: string) => opts.find((o) => o.name === n)!.id;
		expect(m.scores).toEqual({ [idOf('Great')]: 5, [idOf('Okay')]: 3 });
		const stored = db.select({ values: entry.values }).from(entry).where(eq(entry.occurrenceId, occ)).all().map((e) => e.values[h.mood]);
		expect(stored).toEqual([idOf('Great'), idOf('Okay'), idOf('Meh')]);
		expect(values(h.name).map((v) => [v.value, v.score])).toEqual([
			['Great', 5],
			['Okay', 3],
			['Meh', null]
		]);

		const smokeFeelings = db.select({ t: habit.triggers }).from(habit).where(eq(habit.id, smoke)).get()!.t!;
		expect(smokeFeelings.map((f) => f.name)).toEqual(['Bored', 'Stressed', 'Tired', 'Social', 'After a meal']);
		expect(feelings('Old smoking')).toEqual(['Stressed']);
		const vapeFeelings = db.select({ t: habit.triggers }).from(habit).where(eq(habit.id, vape)).get()!.t!;
		expect(vapeFeelings.map((f) => [f.name, !!f.archived])).toEqual([
			['Bored', false],
			['Angry', false],
			['Gone', true]
		]);
		expect(feelings('Old vaping').sort()).toEqual(['Angry', 'Gone']);

		expect(db.transaction((tx) => upgradeOptionIds(tx))).toEqual({ metrics: 0, habits: 0 });
	});

	const feelings = (name: string) => (run('logs', { habits: [name], status: ['slip'], days: 30 }).rows as { feeling?: string | null }[]).map((r) => r.feeling);
});
