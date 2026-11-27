// Setup from outside the app, against a real (in-memory) database: previews change nothing,
// apply saves through the editors' checks, names and short keys become ids, and undo puts it back.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { habit, habitIdentity, metric, task } from '../db/schema';
import { createAccount } from '../auth';
import { getSettings, saveSettings } from '../settings';
import { getStats } from '../stats';
import { pausesOf } from '../pauses';
import { listAreas } from '../repo/areas';
import { getHabitForm } from '../repo/habits';
import { getTaskForm } from '../repo/tasks';
import { appActor, ActionError, type Actor } from './actor';
import { catalog, runAction } from './actions';
import { EXAMPLES } from './setup-guide';
import type { readAccount, readStats } from './setup-account';

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

	it('keeps a Variant\'s Slots when it is renamed without them', () => {
		const id = habitNamed('Running')!.id;
		const slotsBefore = getHabitForm(me, id)!.variants[0].slots;
		const a = setup([{ op: 'edit_habit', habit: 'Running', set: { variants: [{ name: 'Run', id: getHabitForm(me, id)!.variants[0].id }, { name: 'Long run' }] } }], { apply: true });
		const after = getHabitForm(me, id)!;
		expect(after.variants.map((v) => v.name)).toEqual(['Run', 'Long run']);
		expect(after.variants[0].slots).toEqual(slotsBefore);
		run('setup_undo', { undo: a.undo });
		expect(getHabitForm(me, id)!.variants.map((v) => v.name)).toEqual(['Run']);
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

	it('saves a view by names, shows the views before and after, and undoes it', () => {
		const p = setup([{ op: 'view', change: { op: 'save', page: 'today', name: 'Gym days', state: { habit: 'Running', sort: 'cue', group: 'part' } } }]);
		expect(p.summary).toEqual(['Add the view “Gym days” to Today']);
		const views = (x: unknown) => (x as { views: { pages: { today: { on: string; views: { name: string; state: Record<string, unknown> }[] } } } }).views.pages.today;
		expect(views(p.before).views.map((v) => v.name)).toEqual(['Default']);
		const made = views(p.after).views.find((v) => v.name === 'Gym days')!;
		expect(made.state).toEqual({ habit: habitNamed('Running')!.id, sort: 'cue', group: 'part' });
		expect(views(p.after).on).toBe('Gym days');
		const a = setup([{ op: 'view', change: { op: 'save', page: 'today', name: 'Gym days', state: { habit: 'Running', sort: 'cue', group: 'part' } } }], { apply: true });
		const r = run('setup_read', { ref: 'views' }) as unknown as { views: unknown; options: { sorts: { today: Record<string, string> } } };
		expect(views(r).on).toBe('Gym days');
		expect(Object.keys(r.options.sorts.today)).toContain('cue');
		// A view by its name, then the layout.
		const b = setup(
			[
				{ op: 'view', change: { op: 'select', page: 'today', view: 'default' } },
				{ op: 'view', change: { op: 'patch', today: { timeAware: true } } }
			],
			{ apply: true }
		);
		expect(b.summary).toEqual(['Put Today on the view “Default”', 'Change the layout: today']);
		run('setup_undo', { undo: b.undo });
		expect(views(run('setup_read', { ref: 'views' })).on).toBe('Gym days');
		run('setup_undo', { undo: a.undo });
		expect(views(run('setup_read', { ref: 'views' })).views.map((v) => v.name)).toEqual(['Default']);
	});

	it('needs edit access and a key that sees every habit', () => {
		const reader: Actor = { ...app, scopes: new Set(['read']) };
		fails(() => runAction(reader, 'setup', { changes: [{ op: 'archive', habit: 'Running' }] }), 'forbidden', /edit/);
		// Notes stay out of what a key without notes access reads, and an edit keeps them.
		const noNotes: Actor = { ...app, scopes: new Set(['read', 'edit']) };
		setup([{ op: 'edit_habit', habit: 'Running', set: { notes: 'Private: knee hurts' } }], { apply: true });
		const read = runAction(noNotes, 'setup_read', { ref: 'habit:Running' }) as { form: Record<string, unknown> };
		expect(read.form).not.toHaveProperty('notes');
		runAction(noNotes, 'setup', { changes: [{ op: 'edit_habit', habit: 'Running', set: read.form }], apply: true });
		expect(getHabitForm(me, habitNamed('Running')!.id)!.notes).toBe('Private: knee hurts');
		const limited: Actor = { ...app, habitIds: new Set([habitNamed('Running')!.id]) };
		fails(() => runAction(limited, 'setup', { changes: [{ op: 'archive', habit: 'Running' }] }), 'forbidden', /every habit/);
	});

	it('keeps the tool list small: details are in setup_guide', () => {
		const c = catalog(app);
		const setupTools = c.actions.filter((a) => a.name.startsWith('setup'));
		expect(setupTools.map((a) => a.name).sort()).toEqual(['setup', 'setup_guide', 'setup_read', 'setup_undo']);
		expect(JSON.stringify(setupTools).length).toBeLessThan(8_000);
		const guide = run('setup_guide', { topic: 'habit' }) as unknown as { schema: { properties: Record<string, unknown> } };
		expect(Object.keys(guide.schema.properties)).toContain('variants');
	});
});

describe('setup: the account', () => {
	const stats = () => getStats(me);

	it('adds a measure, a board with a card and a number on Today, and undo takes them away', () => {
		const ex = EXAMPLES.filter((e) => e.changes.some((c) => c.op === 'measure' || c.op === 'stats')).flatMap((e) => e.changes as unknown[]);
		const p = setup(ex);
		expect(p.summary).toEqual([
			'Add the measure “Speed”: [Distance] / [Time] * 60 in km/h',
			'Add the Stats board “Running”',
			'Save the card “Km per week” on a Stats board',
			'Show a number for “Running” on Today'
		]);
		// The preview shows only the parts of the account that change.
		const before = (p.before as { account: Record<string, unknown> }).account;
		const after = (p.after as { account: Record<string, unknown> }).account;
		expect(Object.keys(after).sort()).toEqual(['boards', 'measures', 'todayNumbers']);
		expect(before.measures).toEqual([]);
		expect(after.boards).toEqual([{ name: 'Running', range: '30d', cards: ['Km per week'] }]);
		expect(stats().measures).toEqual([]);

		const a = setup(ex, { apply: true, check: p.check });
		const s = stats();
		const speed = s.measures.find((m) => m.name === 'Speed')!;
		expect(speed).toMatchObject({ formula: '[Distance] / [Time] * 60', per: 'log', combine: 'avg', unit: 'km/h' });
		const board = s.boards.find((b) => b.name === 'Running')!;
		expect(board.cards[0]).toMatchObject({ title: 'Km per week', what: { source: 'field' }, overTime: 'sum', bucket: 'week', range: '12m', look: { chart: 'bars' } });
		const running = habitNamed('Running')!.id;
		expect(s.headlines[running]).toMatchObject({ title: 'Km this week', look: { chart: 'tile' } });

		// A measure is changed and deleted by name; one a card counts by is turned off instead.
		const u1 = setup([{ op: 'measure', measure: 'speed', set: { unit: 'kph' } }], { apply: true });
		expect(stats().measures.find((m) => m.name === 'Speed')!.unit).toBe('kph');
		const c1 = setup([{ op: 'stats', change: { op: 'card.save', where: { habit: 'Running' }, card: { title: 'Speed', source: 'task', task: 'Run', measure: 'Speed', combine: 'avg' } } }], { apply: true });
		const del = setup([{ op: 'measure', measure: 'Speed', delete: true }], { apply: true });
		expect(del.summary[0]).toMatch(/Turn off the measure “Speed” \(1 card still count/);
		expect(stats().measures.find((m) => m.name === 'Speed')!.off).toBe(true);
		run('setup_undo', { undo: del.undo });
		expect(stats().measures.find((m) => m.name === 'Speed')!.off).toBeUndefined();

		fails(() => setup([{ op: 'measure', set: { name: 'Broken', formula: '[Weight] *' } }]), 'invalid', /can't be worked out/);
		fails(() => setup([{ op: 'measure', set: { name: 'speed', formula: '[Distance]' } }]), 'conflict', /already a measure/);
		fails(() => setup([{ op: 'stats', change: { op: 'board.delete', board: 'Nope' } }]), 'not_found', /No board “Nope”/);

		// Undo in reverse order: the card on the Stats tab, the unit, then the first request.
		const later = setup([{ op: 'stats', change: { op: 'habit.reset', habit: 'Running' } }], { apply: true });
		run('setup_undo', { undo: later.undo });
		for (const x of [c1, u1, a]) expect((run('setup_undo', { undo: x.undo }) as unknown as { kept: string[] }).kept).toEqual([]);
		fails(() => run('setup_undo', { undo: a.undo }), 'conflict', /already undone/);
		expect(stats().measures).toEqual([]);
		expect(stats().boards.some((b) => b.name === 'Running')).toBe(false);
	});

	it("names an Area in a board's filter, and keeps its id", () => {
		const a = setup([{ op: 'area', area: 'Filtered' }, { op: 'stats', change: { op: 'board.add', name: 'Setup' } }], { apply: true });
		const id = listAreas(me).find((x) => x.name === 'Filtered')!.id;
		const filter = () => stats().boards.find((x) => x.name === 'Setup')!.filter;
		const b = setup([{ op: 'stats', change: { op: 'board.patch', board: 'Setup', toggle: [{ list: 'areas', value: 'filtered', on: true }] } }], { apply: true });
		expect(filter().areas).toEqual([id]);
		const c = setup([{ op: 'stats', change: { op: 'board.patch', board: 'Setup', filter: { areas: ['Filtered'] } } }], { apply: true });
		expect(filter().areas).toEqual([id]);
		fails(() => setup([{ op: 'stats', change: { op: 'board.patch', board: 'Setup', toggle: [{ list: 'areas', value: 'Nope', on: true }] } }]), 'not_found', /No Area “Nope”/);
		for (const x of [c, b, a]) run('setup_undo', { undo: x.undo });
		expect(stats().boards.some((x) => x.name === 'Setup')).toBe(false);
	});

	it('changes settings lines through the Settings checks, and puts them back', () => {
		const was = getSettings(me);
		const ex = EXAMPLES.find((e) => e.goal.startsWith('The day starts'))!;
		const a = setup(ex.changes, { apply: true });
		expect(a.summary[0]).toBe('Change settings: day start, parts of the day');
		expect(getSettings(me).dayStart).toBe('04:00');
		expect(getSettings(me).ranges.map((r) => r.name)).toEqual(['Morning', 'Evening']);
		expect(pausesOf(me, null)).toMatchObject([{ start: '2026-12-24', end: '2026-12-31', note: 'Holidays' }]);
		fails(() => setup([{ op: 'settings', set: { ranges: [{ name: 'Day', start: '06:00', end: '10:00' }, { name: 'day', start: '11:00', end: '12:00' }] } }]), 'invalid', /Two parts of the day/);
		fails(() => setup([{ op: 'settings', set: { colour: 'blue' } }]), 'invalid');
		run('setup_undo', { undo: a.undo });
		expect(getSettings(me).dayStart).toBe(was.dayStart);
		expect(getSettings(me).ranges).toEqual(was.ranges);
		expect(pausesOf(me, null)).toEqual([]);
	});

	it('Areas, identities, packs, tags, pauses, shortcuts, Collections, Task types and My templates, all undone together', () => {
		const p = setup([
			{ op: 'area', area: 'Garden', set: { color: '#16a34a', icon: '🌱' } },
			{ op: 'identity', identity: 'I am a runner' },
			{ op: 'pack', pack: 'Gym' },
			{ op: 'tag', tag: 'glutes', grouping: 'Muscle groups' },
			{ op: 'add_task', key: 'dl', task: { name: 'Deadlift', type: 'Strength' } },
			{ op: 'collection', set: { name: 'Pulls', tasks: ['dl'] } },
			{ op: 'pause', habit: 'Running', from: '2026-12-01', to: '2026-12-07', note: 'Sick' },
			{ op: 'pin', habit: 'Running' },
			{ op: 'save_template', habit: 'Running', name: 'My running' },
			{ op: 'remove_template', template: 'My running' }
		]);
		const changed = Object.keys((p.after as { account: object }).account).sort();
		expect(changed).toEqual(expect.arrayContaining(['areas', 'collections', 'groupings', 'identities', 'packs', 'pauses', 'shortcuts', 'tags', 'taskTypes', 'units']));
		expect(changed).not.toContain('myTemplates');
		const a = setup(
			[
				{ op: 'area', area: 'Garden', set: { color: '#16a34a', icon: '🌱' } },
				{ op: 'identity', identity: 'I am a runner' },
				{ op: 'pack', pack: 'Gym' },
				{ op: 'tag', tag: 'glutes', grouping: 'Muscle groups' },
				{ op: 'add_task', key: 'dl', task: { name: 'Deadlift', type: 'Strength' } },
				{ op: 'collection', set: { name: 'Pulls', tasks: ['dl'] } },
				{ op: 'pause', habit: 'Running', from: '2026-12-01', to: '2026-12-07', note: 'Sick' },
				{ op: 'pin', habit: 'Running' }
			],
			{ apply: true }
		);
		const read = run('setup_read', { ref: 'settings' }) as unknown as ReturnType<typeof readAccount>;
		expect(read.areas.find((x) => x.name === 'Garden')).toMatchObject({ color: '#16a34a', icon: '🌱' });
		expect(read.identities.map((i) => i.statement)).toContain('I am a runner');
		expect(read.packs.find((x) => x.id === 'gym')!.in).toBe(true);
		expect(read.tags.find((t) => t.name === 'glutes')).toMatchObject({ grouping: 'Muscle groups' });
		expect(read.collections.find((c) => c.name === 'Pulls')!.tasks).toEqual(['Deadlift']);
		expect(read.pauses).toMatchObject([{ habit: 'Running', from: '2026-12-01', to: '2026-12-07', note: 'Sick' }]);
		expect(read.shortcuts.map((x) => x.name)).toEqual(['Running']);
		const dl = getTaskForm(me, taskNamed('Deadlift')!.id)!;
		expect(dl.metrics.map((m) => m.name)).toEqual(['Weight', 'Reps']);
		expect(dl.restTimerEnabled).toBe(true);

		// Changing and taking away by name.
		const b = setup(
			[
				{ op: 'area', area: 'garden', set: { name: 'Yard' } },
				{ op: 'identity', identity: 'I am a runner', statement: 'I run' },
				{ op: 'tag', tag: 'glutes', name: 'bum' },
				{ op: 'pause', habit: 'Running', from: '2026-12-03', remove: true },
				{ op: 'pin', habit: 'Running', pinned: false },
				{ op: 'collection', collection: 'Pulls', delete: true }
			],
			{ apply: true }
		);
		const r2 = run('setup_read', { ref: 'settings' }) as unknown as ReturnType<typeof readAccount>;
		expect(r2.areas.some((x) => x.name === 'Yard')).toBe(true);
		expect(r2.identities.map((i) => i.statement)).toContain('I run');
		// Two identities never say the same: rewording one as another's sentence is refused, as adding it finds that one.
		fails(() => setup([{ op: 'identity', identity: 'I lift' }, { op: 'identity', identity: 'I run', statement: 'i lift' }]), 'invalid', /Another identity says “i lift” already/);
		expect(setup([{ op: 'identity', identity: 'I swim', statement: 'i RUN' }]).changes[0].summary).toBe('Identity “I run”: nothing changes');
		expect(r2.tags.some((t) => t.name === 'bum')).toBe(true);
		expect(r2.pauses).toEqual([]);
		expect(r2.shortcuts).toEqual([]);
		expect(r2.collections.some((c) => c.name === 'Pulls')).toBe(false);
		run('setup_undo', { undo: b.undo });
		const r3 = run('setup_read', { ref: 'settings' }) as unknown as ReturnType<typeof readAccount>;
		expect(r3.areas.some((x) => x.name === 'Garden')).toBe(true);
		expect(r3.identities.map((i) => i.statement)).toContain('I am a runner');
		expect(r3.tags.some((t) => t.name === 'glutes')).toBe(true);
		expect(r3.pauses).toHaveLength(1);
		expect(r3.shortcuts.map((x) => x.name)).toEqual(['Running']);
		expect(r3.collections.find((c) => c.name === 'Pulls')!.tasks).toEqual(['Deadlift']);

		const back = run('setup_undo', { undo: a.undo }) as unknown as { kept: string[] };
		expect(back.kept).toEqual([]);
		const r4 = run('setup_read', { ref: 'settings' }) as unknown as ReturnType<typeof readAccount>;
		expect(r4.areas.some((x) => x.name === 'Garden')).toBe(false);
		expect(r4.identities.map((i) => i.statement)).not.toContain('I am a runner');
		expect(r4.packs.find((x) => x.id === 'gym')!.in).toBe(false);
		expect(r4.tags.some((t) => t.name === 'glutes')).toBe(false);
		expect(r4.collections).toEqual([]);
		expect(r4.pauses).toEqual([]);
		expect(r4.shortcuts).toEqual([]);
	});

	it('undo of an identity added after one that said it was deleted: once the Delete is undone, the habits stay with it', () => {
		setup([{ op: 'identity', identity: 'I row' }], { apply: true });
		const row = (run('setup_read', { ref: 'settings' }) as unknown as ReturnType<typeof readAccount>).identities.find((i) => i.statement === 'I row')!;
		db.insert(habitIdentity).values({ habitId: habitNamed('Running')!.id, identityId: row.id }).run();
		const del = setup([{ op: 'identity', identity: 'I row', delete: true }], { apply: true });
		const add = setup([{ op: 'identity', identity: 'i row' }], { apply: true });
		run('setup_undo', { undo: del.undo });
		const back = run('setup_undo', { undo: add.undo }) as unknown as { kept: string[] };
		expect(back.kept).toEqual([expect.stringMatching(/has habits now, so it stays/)]);
		const left = (run('setup_read', { ref: 'settings' }) as unknown as ReturnType<typeof readAccount>).identities.filter((i) => i.statement.toLowerCase() === 'i row');
		expect(left).toHaveLength(1);
		expect(db.select().from(habitIdentity).where(eq(habitIdentity.identityId, left[0].id)).all()).toHaveLength(1);
		setup([{ op: 'identity', identity: 'I row', delete: true }], { apply: true });
	});

	it('deletes a habit, and setup_undo puts it back while it can', () => {
		setup([{ op: 'add_habit', habit: { name: 'Throwaway', schedule: { kind: 'interval', every: 1 } } }], { apply: true });
		const d = setup([{ op: 'delete', habit: 'Throwaway' }], { apply: true });
		expect(d.changes[0].warnings).toEqual([expect.stringMatching(/gone for good after 24 hours/)]);
		expect(habitNamed('Throwaway')!.deleteAfter).not.toBeNull();
		run('setup_undo', { undo: d.undo });
		expect(habitNamed('Throwaway')!.deleteAfter).toBeNull();
		expect(habitNamed('Throwaway')!.archived).toBe(false);
	});

	it('reads Stats in the shape the changes take', () => {
		const r = run('setup_read', { ref: 'stats' }) as unknown as ReturnType<typeof readStats>;
		expect(r.boardTemplates.map((b) => b.id)).toContain('overview');
		expect(Array.isArray(r.measures)).toBe(true);
		const guide = run('setup_guide', { topic: 'stats' }) as unknown as { cardSchema: object; examples: unknown[] };
		expect(guide.examples.length).toBe(2);
	});
});
