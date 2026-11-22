// Whole programs as templates, against a real (in-memory) database: sharing a routine or a group
// takes the habits inside it along, and adding the file puts them back inside, all or nothing.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { habit, task } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { loadToday, userToday } from './today';
import { getHabitForm, saveHabit, setHabitArchived } from './repo/habits';
import { saveTask } from './repo/tasks';
import { addTemplate } from './repo/templates';
import { shareContext, shareFile } from './share';
import { habitForm, taskForm } from '$lib/forms';
import { templateFile, type TemplateFile } from '$lib/template';
import { addDays } from '$lib/engine/dates';

let me: string;
let today: string;

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('programs', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
});

const save = (f: unknown) => saveHabit(me, null, habitForm.parse(f), today)!;
const kidsOf = (id: string) => db.select().from(habit).where(eq(habit.parentId, id)).all();
const count = () => [db.select().from(habit).all().length, db.select().from(task).all().length];
/** The file as it would come back from a download. */
const roundTrip = (f: TemplateFile | null) => templateFile.parse(JSON.parse(JSON.stringify(f)));

/** A program: Base for a week, then Build. Walk comes up in Base weeks, Run in Build weeks. */
function program(started: string) {
	const base = randomUUID();
	const build = randomUUID();
	const id = save({
		name: `Program ${randomUUID().slice(0, 4)}`,
		direction: 'build',
		startDate: started,
		variants: [
			{ id: base, name: 'Base', slots: [] },
			{ id: build, name: 'Build', slots: [] }
		],
		schedule: {
			kind: 'phases',
			start: started,
			phases: [
				{ length: 1, unit: 'week', schedule: { kind: 'interval', every: 1, start: started, variantId: base } },
				{ length: null, unit: 'week', schedule: { kind: 'interval', every: 1, start: started, variantId: build } }
			]
		}
	});
	const kid = (name: string, on: string) => {
		const v = randomUUID();
		return save({ name, direction: 'build', startDate: started, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'follow', variantId: v, on: [on] }, parentId: id });
	};
	return { id, walk: kid('Walk', base), run: kid('Run', build) };
}

describe('a whole program as a template', () => {
	it('shares a routine with the habits that follow it, and adds it back as one program', () => {
		const p = program(addDays(today, -7));
		const file = roundTrip(shareFile(me, p.id));
		// In the order the Habits list has them.
		expect(file.children.map((c) => [c.name, c.parent])).toEqual([
			['Run', null],
			['Walk', null]
		]);

		const r = addTemplate(me, file, { today });
		if ('error' in r) throw new Error(r.error);
		expect(r.inside).toBe(2);
		const added = getHabitForm(me, r.habitId)!;
		const [base, build] = added.variants.map((v) => v.id);
		const kids = kidsOf(r.habitId).sort((a, b) => b.name.localeCompare(a.name));
		expect(kids.map((k) => [k.name, k.schedule])).toEqual([
			['Walk', { kind: 'follow', variantId: expect.any(String), on: [base] }],
			['Run', { kind: 'follow', variantId: expect.any(String), on: [build] }]
		]);
		// The copy starts today, in its Base week: Walk is due and Run isn't. The original is in Build.
		const due = loadToday(me, today).build.map((x) => x.habitId);
		const [walk, run] = kids.map((k) => k.id);
		expect(due).toContain(walk);
		expect(due).not.toContain(run);
		expect(due).toContain(p.run);
		expect(due).not.toContain(p.walk);
	});

	it('shares a group with what is inside it, at any depth, leaving archived habits out', () => {
		const t = saveTask(me, null, taskForm.parse({ name: `Bench ${randomUUID().slice(0, 4)}`, restTimerEnabled: false, restTimerSeconds: 90, tags: [], metrics: [{ id: randomUUID(), name: 'Weight', type: 'number', repeats: false }], parts: [] }))!;
		const group = (name: string, parentId: string | null) =>
			save({ name, direction: 'build', startDate: today, variants: [], schedule: { kind: 'group', minimum: null, target: null }, parentId });
		const daily = (name: string, parentId: string, taskId: string | null = null) => {
			const v = randomUUID();
			return save({
				name,
				direction: 'build',
				startDate: today,
				variants: [{ id: v, name: 'Main', slots: taskId ? [{ id: randomUUID(), taskId, fillRule: null, sets: 3, targets: {} }] : [] }],
				schedule: { kind: 'interval', every: 1, start: today, variantId: v },
				parentId
			});
		};
		const empty = group('Empty', null);
		expect(shareFile(me, empty)).toBeNull();

		const top = group('Mornings', null);
		daily('Bench', top, t);
		const inner = group('Stretches', top);
		daily('Hips', inner);
		setHabitArchived(me, daily('Old', inner), true);
		expect(shareContext(me, top)?.inside).toEqual([
			{ name: 'Bench', depth: 1 },
			{ name: 'Stretches', depth: 1 },
			{ name: 'Hips', depth: 2 }
		]);
		const file = roundTrip(shareFile(me, top));
		expect(file.children.map((c) => [c.key, c.parent, c.name])).toEqual([
			['h1', null, 'Bench'],
			['h2', null, 'Stretches'],
			['h3', 'h2', 'Hips']
		]);
		expect(file.tasks.map((x) => x.name)).toEqual([expect.stringMatching(/^Bench /)]);

		const r = addTemplate(me, file, { today, reuse: true });
		if ('error' in r) throw new Error(r.error);
		const stretches = kidsOf(r.habitId).find((k) => k.name === 'Stretches')!;
		expect(kidsOf(stretches.id).map((k) => k.name)).toEqual(['Hips']);
		// The Task already in the Library is used, not copied.
		expect(r).toMatchObject({ reused: 1, created: 0, inside: 3 });
	});

	it('adds nothing when a habit inside can\'t go where the file puts it', () => {
		const p = program(today);
		const file = roundTrip(shareFile(me, p.id));
		const before = count();
		// A parent key the file doesn't have.
		const lost = addTemplate(me, { ...file, children: [{ ...file.children[0], parent: 'nope' }] }, { today });
		expect(lost).toMatchObject({ error: expect.stringContaining("doesn't have before it") });
		// A follower inside a group: a group has no days of its own to follow.
		const group: TemplateFile = {
			...file,
			habit: { ...file.habit, variants: [], schedule: { kind: 'group', minimum: null, target: null } },
			children: file.children.map((c) => ({ ...c, schedule: { kind: 'follow', variantId: 'v1', on: null } }))
		};
		expect(addTemplate(me, group, { today })).toMatchObject({ error: expect.stringContaining("can't go inside its habit") });
		expect(count()).toEqual(before);
	});
});
