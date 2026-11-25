// Setup from outside the app, against a real (in-memory) database: previews change nothing,
// apply saves through the editors' checks, names and short keys become ids, and undo puts it back.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { habit, metric, task } from '../db/schema';
import { createAccount } from '../auth';
import { saveSettings } from '../settings';
import { getHabitForm } from '../repo/habits';
import { getTaskForm } from '../repo/tasks';
import { appActor, ActionError, type Actor } from './actor';
import { catalog, runAction } from './actions';
import { EXAMPLES } from './setup-guide';

let me: string;
let app: Actor;

type Answer = Record<string, unknown> & { summary: string[]; changes: Record<string, unknown>[] };
const run = (name: string, input: unknown, a: Actor = app) => runAction(a, name, input) as Answer;
const setup = (changes: unknown[], more: Record<string, unknown> = {}) => run('setup', { changes, ...more });
const habits = () => db.select().from(habit).where(eq(habit.accountId, me)).all();
const habitNamed = (name: string) => habits().find((h) => h.name === name);
const taskNamed = (name: string) => db.select().from(task).where(and(eq(task.accountId, me), eq(task.name, name))).get();
const fails = (fn: () => unknown, code: ActionError['code'], text?: RegExp) => {
	try {
		fn();
	} catch (e) {
		expect(e).toBeInstanceOf(ActionError);
		expect((e as ActionError).code).toBe(code);
		if (text) expect((e as ActionError).message).toMatch(text);
		return;
	}
	throw new Error('expected a failure');
};

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('setup-tester', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	app = appActor(me);
});

describe('setup', () => {
	const spanish = {
		op: 'add_template',
		template: {
			habit: {
				name: 'Spanish',
				direction: 'build',
				schedule: { kind: 'interval', every: 1, variantId: 'Daily' },
				variants: [{ name: 'Daily', slots: [{ task: 'Spanish study', targets: { Minutes: 15 }, minTargets: { mins: 5 } }] }],
				levels: { enabled: true, minimum: '5 minutes', target: '15 minutes', stretch: '30 minutes' }
			},
			tasks: [
				{
					key: 'study',
					name: 'Spanish study',
					metrics: [
						{ key: 'mins', name: 'Minutes', type: 'duration', unit: 'min' },
						{ key: 'what', name: 'What', type: 'choice', choices: ['App', 'Podcast'] }
					]
				}
			]
		}
	};

	it('previews without saving anything, with the habit as it would be', () => {
		const p = run('setup', { changes: [spanish] });
		expect(p.preview).toBe(true);
		expect(p.summary[0]).toMatch(/Add “Spanish” \(1 new Task\)/);
		const after = p.after as { habits: { name: string; schedule: string; variants: { tasks: { task: string; targets: Record<string, number> }[] }[] }[]; tasks: unknown[] };
		expect(after.habits[0].name).toBe('Spanish');
		expect(after.habits[0].schedule).toMatch(/day/i);
		expect(after.habits[0].variants[0].tasks[0]).toMatchObject({ task: 'Spanish study', targets: { Minutes: 15 } });
		expect(after.tasks).toHaveLength(1);
		expect(typeof p.check).toBe('string');
		expect(habitNamed('Spanish')).toBeUndefined();
		expect(taskNamed('Spanish study')).toBeUndefined();
	});

	it('applies what the preview showed, refuses a stale check, and undoes it all', () => {
		const p = setup([spanish]);
		fails(() => setup([spanish], { apply: true, check: 'not-the-check' }), 'conflict', /Preview again/);
		expect(habitNamed('Spanish')).toBeUndefined();
		const a = setup([spanish], { apply: true, check: p.check });
		expect(a.preview).toBe(false);
		const h = habitNamed('Spanish')!;
		const form = getHabitForm(me, h.id)!;
		// Targets keyed by field name and by the file's key both land on the right field.
		const mins = db.select().from(metric).where(eq(metric.name, 'Minutes')).get()!;
		expect(form.variants[0].slots[0].targets).toEqual({ [mins.id]: 15 });
		expect(form.variants[0].slots[0].minTargets).toEqual({ [mins.id]: 5 });
		const u = run('setup_undo', { undo: a.undo });
		expect(u.undone).toEqual(a.summary);
		expect(habitNamed('Spanish')?.deleteAfter ?? null).not.toBeNull();
		fails(() => run('setup_undo', { undo: a.undo }), 'conflict', /already undone/);
	});

	it('builds a gym A/B rotation from names, with field keys repeated per Task', () => {
		const gym = EXAMPLES.find((e) => e.goal.startsWith('Gym'))!;
		const a = setup(gym.changes, { apply: true });
		const h = habitNamed('Gym')!;
		const form = getHabitForm(me, h.id)!;
		expect(form.schedule?.kind).toBe('rotation');
		const [A, B] = form.variants;
		expect(form.schedule && 'order' in form.schedule && form.schedule.order.map((o) => o.variantId)).toEqual([A.id, B.id]);
		const bench = getTaskForm(me, taskNamed('Bench press')!.id)!;
		const benchSlot = A.slots[1];
		expect(benchSlot.taskId).toBe(taskNamed('Bench press')!.id);
		const w = bench.metrics.find((m) => m.name === 'Weight')!;
		expect(benchSlot.targets[w.id]).toBe(40);
		expect(B.slots[1].taskId).toBe(taskNamed('Barbell row')!.id);
		run('setup_undo', { undo: a.undo });
	});

	it('runs every worked example in the guide', () => {
		// The edit examples change things that exist.
		setup(
			[
				{ op: 'add_task', key: 'run', task: { name: 'Run', metrics: [{ name: 'Distance', type: 'number', unit: 'km' }, { name: 'Time', type: 'duration', unit: 'min' }] } },
				{ op: 'add_habit', habit: { name: 'Running', schedule: { kind: 'interval', every: 1 }, variants: [{ name: 'Run', slots: [{ taskId: 'run', targets: { Distance: 5 } }] }] } }
			],
			{ apply: true }
		);
		for (const ex of EXAMPLES) {
			const p = setup(ex.changes);
			expect(p.preview, ex.goal).toBe(true);
			expect(p.changes.every((c) => !String(c.summary).includes('nothing changes')), ex.goal).toBe(true);
		}
	});

	it('makes a routine with habits inside from keys, and moves the Run Task forward without losing its fields', () => {
		const routine = EXAMPLES.find((e) => e.goal.startsWith('A morning routine'))!;
		setup(routine.changes, { apply: true });
		const r = habitNamed('Morning routine')!;
		const inside = habits().filter((h) => h.parentId === r.id);
		expect(inside.map((h) => h.name).sort()).toEqual(['Glass of water', 'Make the bed', 'Stretch 5 minutes']);
		expect(inside.every((h) => (h.schedule as { kind: string }).kind === 'follow')).toBe(true);

		const before = getTaskForm(me, taskNamed('Run')!.id)!;
		const kind = EXAMPLES.find((e) => e.goal.startsWith('Add a choice'))!;
		const a = setup(kind.changes, { apply: true });
		const after = getTaskForm(me, taskNamed('Run')!.id)!;
		// Named like the fields it had: the same fields, so their logs stay theirs.
		expect(after.metrics.slice(0, 2).map((m) => m.id)).toEqual(before.metrics.map((m) => m.id));
		expect(after.metrics[2]).toMatchObject({ name: 'Kind', type: 'choice' });
		expect(after.metrics[2].choices.map((c) => c.name)).toEqual(['Easy', 'Tempo', 'Long']);
		expect(a.changes[0].changed).toEqual(['metrics']);
		run('setup_undo', { undo: a.undo });
		expect(getTaskForm(me, taskNamed('Run')!.id)!.metrics.map((m) => m.name)).toEqual(['Distance', 'Time']);
	});

	it('edits a schedule from today on, says what changed, and undoes it', () => {
		const id = habitNamed('Running')!.id;
		const p = setup([{ op: 'edit_habit', habit: 'running', set: { schedule: { kind: 'frequency', times: 3, period: 'week' } } }]);
		expect(p.changes[0].changed).toEqual(['schedule']);
		const before = (p.before as { habits: { schedule: string }[] }).habits[0].schedule;
		const after = (p.after as { habits: { schedule: string }[] }).habits[0].schedule;
		expect(before).not.toBe(after);
		expect(getHabitForm(me, id)!.schedule?.kind).toBe('interval');
		const a = setup([{ op: 'edit_habit', habit: 'running', set: { schedule: { kind: 'frequency', times: 3, period: 'week' } } }], { apply: true, check: p.check });
		expect(getHabitForm(me, id)!.schedule?.kind).toBe('frequency');
		run('setup_undo', { undo: a.undo });
		expect(getHabitForm(me, id)!.schedule?.kind).toBe('interval');
	});

	it('says exactly what is wrong, and saves nothing of a request with one bad change', () => {
		fails(() => setup([{ op: 'add_habit', habit: { name: 'Lift', variants: [{ name: 'A', slots: [{ taskId: 'Deadlift' }] }], schedule: { kind: 'interval', every: 1 } } }]), 'not_found', /Change 1 \(add_habit\): No Task called “Deadlift”/);
		fails(() => setup([{ op: 'add_habit', habit: { name: 'Lift', variants: [{ name: 'A' }, { name: 'B' }], schedule: { kind: 'weekly', days: { '0': 'A', '2': 'C' } } } }]), 'invalid', /Variant “C”/);
		fails(() => setup([{ op: 'add_habit', habit: { name: 'Run more', variants: [{ name: 'Run', slots: [{ taskId: 'Run', targets: { Pace: 5 } }] }], schedule: { kind: 'interval', every: 1 } } }]), 'invalid', /“Run” has no field “Pace”/);
		fails(() => setup([{ op: 'add_habit', habit: { name: 'No schedule' } }]), 'invalid', /needs a Schedule/);
		const n = habits().length;
		fails(
			() =>
				setup(
					[
						{ op: 'add_habit', habit: { name: 'Fine one', schedule: { kind: 'interval', every: 1 } } },
						{ op: 'edit_habit', habit: 'Nope nope', set: { name: 'x' } }
					],
					{ apply: true }
				),
			'not_found',
			/Change 2/
		);
		expect(habits().length).toBe(n);
	});

	it('archives and brings back, reads forms with names, and keeps a habit as a template', () => {
		const a = setup([{ op: 'archive', habit: 'Running' }], { apply: true });
		expect(habitNamed('Running')!.archived).toBe(true);
		run('setup_undo', { undo: a.undo });
		expect(habitNamed('Running')!.archived).toBe(false);

		const r = run('setup_read', { ref: 'habit:Running' }) as unknown as { form: { variants: { slots: { taskId: string }[] }[] }; names: { tasks: Record<string, string>; fields: Record<string, string> } };
		expect(r.names.tasks[r.form.variants[0].slots[0].taskId]).toBe('Run');
		expect(Object.values(r.names.fields)).toContain('Run › Distance (km)');
		const t = run('setup_read', { ref: 'habit:Running', as: 'template' }) as unknown as { template: { format: string } };
		expect(t.template.format).toBe('ittracks-template');
		const list = run('setup_read', { ref: 'templates' }) as unknown as { builtIn: { ref: string }[]; mine: unknown[] };
		expect(list.builtIn.some((b) => b.ref === 'template:beginner-5x5')).toBe(true);

		const s = setup([{ op: 'save_template', habit: 'Running', name: 'My running' }], { apply: true });
		const mine = (run('setup_read', { ref: 'templates' }) as unknown as { mine: { name: string }[] }).mine;
		expect(mine.map((m) => m.name)).toContain('My running');
		run('setup_undo', { undo: s.undo });
		expect((run('setup_read', { ref: 'templates' }) as unknown as { mine: { name: string }[] }).mine.map((m) => m.name)).not.toContain('My running');
	});

	it('adds a ready-made template with answers', () => {
		const a = setup([{ op: 'add_template', from: 'drink-water', answers: { glasses: 6 } }], { apply: true });
		expect(a.summary[0]).toMatch(/Drink water/);
		run('setup_undo', { undo: a.undo });
	});

	it('needs edit access and a key that sees every habit', () => {
		const reader: Actor = { ...app, scopes: new Set(['read']) };
		fails(() => runAction(reader, 'setup', { changes: [{ op: 'archive', habit: 'Running' }] }), 'forbidden', /edit/);
		const limited: Actor = { ...app, habitIds: new Set([habitNamed('Running')!.id]) };
		fails(() => runAction(limited, 'setup', { changes: [{ op: 'archive', habit: 'Running' }] }), 'forbidden', /every habit/);
	});

	it('keeps the tool list small: details are in setup_guide', () => {
		const c = catalog(app);
		const setupTools = c.actions.filter((a) => a.name.startsWith('setup'));
		expect(setupTools.map((a) => a.name).sort()).toEqual(['setup', 'setup_guide', 'setup_read', 'setup_undo']);
		expect(JSON.stringify(setupTools).length).toBeLessThan(12_000);
		const guide = run('setup_guide', { topic: 'habit' }) as unknown as { schema: { properties: Record<string, unknown> } };
		expect(Object.keys(guide.schema.properties)).toContain('variants');
	});
});
