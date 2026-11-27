// A Slot's Task swapped for one day, or picked again for an auto-filled Slot: what the day holds,
// how it goes back, and which Task what was logged counts for. Against a real (in-memory) database.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { entry, habit, metric, occurrence, slot, tag, task, taskPart, taskTag, variant } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { appActor, type Actor } from './core/actor';
import { runAction } from './core/actions';
import { todayFor } from './core/log';
import { hasParts, ownTask, rerollSlot, swapLibrary, swapSlot, usedBefore } from './day-plan';
import { lastEntries } from './today';
import { recapFor } from './stats';
import { finishAs, keepGoals, progressForIds, verdictsFor } from './progress';
import { addDays } from '$lib/engine/dates';

let me: string;
let app: Actor;
let today: string;
let bench: string;
let incline: string;
let fixed: typeof slot.$inferSelect;
let auto: typeof slot.$inferSelect;

const taskId = (name: string) => db.select().from(task).where(and(eq(task.accountId, me), eq(task.name, name))).get()!.id;
const field = (t: string, name: string) => db.select().from(metric).where(and(eq(metric.taskId, t), eq(metric.name, name))).get()!.id;
const gym = () => db.select().from(habit).where(and(eq(habit.accountId, me), eq(habit.name, 'Gym'))).get()!;
const day = (date: string) => db.select().from(occurrence).where(and(eq(occurrence.habitId, gym().id), eq(occurrence.date, date))).get()!;
const picks = () => day(today).picks ?? {};
const set = (occ: string, t: string, path: string, kg: number, n: number) =>
	db.insert(entry).values({ id: randomUUID(), occurrenceId: occ, taskId: t, path, values: { [field(t, 'Weight')]: kg, [field(t, 'Reps')]: 8 }, sortOrder: n }).run();
const lift = (name: string) => ({
	op: 'add_task',
	task: { name, metrics: [{ name: 'Weight', type: 'number', unit: 'kg', repeats: true }, { name: 'Reps', type: 'count', repeats: true }] }
});

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('swap-tester', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	app = appActor(me);
	today = todayFor(app);
	runAction(app, 'setup', {
		changes: [
			lift('Bench press'),
			lift('Incline bench press'),
			lift('Squat'),
			lift('Lunge'),
			{
				op: 'add_habit',
				habit: {
					name: 'Gym',
					startDate: addDays(today, -1),
					schedule: { kind: 'interval', every: 1 },
					variants: [{ name: 'Push day A', slots: [{ taskId: 'Bench press', sets: 4, targets: { Weight: 60 } }, { taskId: null, fillRule: {} }] }]
				}
			}
		],
		apply: true
	});
	// Habits that count only their full target: a Slot left at nothing would be a miss.
	db.update(habit).set({ minimumCounts: false }).where(eq(habit.id, gym().id)).run();
	bench = taskId('Bench press');
	incline = taskId('Incline bench press');
	const v = db.select().from(variant).where(eq(variant.habitId, gym().id)).get()!;
	[fixed, auto] = db.select().from(slot).where(eq(slot.variantId, v.id)).orderBy(slot.sortOrder).all();
	// Bench press last time, yesterday.
	runAction(app, 'log_task', { habit: 'Gym', date: 'yesterday', task: 'Bench press', sets: [{ Weight: 57.5, Reps: 8 }] });
	db.update(occurrence).set({ status: 'done', finishedAt: new Date() }).where(eq(occurrence.id, day(addDays(today, -1)).id)).run();
	runAction(app, 'today', {});
});

describe('swapping a Slot for the day', () => {
	it('swapping back to the plan\'s own Task clears the swap, so a later change to the plan reaches the day', () => {
		swapSlot(app, day(today), fixed.id, incline);
		expect(picks()[fixed.id]).toBe(incline);
		swapSlot(app, day(today), fixed.id, bench);
		expect(fixed.id in picks()).toBe(false);
		// Swapped twice, then back: still no swap left.
		swapSlot(app, day(today), fixed.id, incline);
		swapSlot(app, day(today), fixed.id, taskId('Lunge'));
		expect(picks()[fixed.id]).toBe(taskId('Lunge'));
		swapSlot(app, day(today), fixed.id, incline);
		expect(picks()[fixed.id]).toBe(incline);
		swapSlot(app, day(today), fixed.id, bench);
		expect(fixed.id in picks()).toBe(false);
		// The auto-filled Slot keeps its pick all along.
		expect(picks()[auto.id]).toBeTruthy();
	});

	it('a Slot\'s own Task is the one its log kept, else the plan\'s; an auto-filled Slot has none', () => {
		expect(ownTask({ goals: null }, fixed.id, fixed)).toBe(bench);
		expect(ownTask({ goals: { [fixed.id]: { taskId: incline, sets: 4, targets: null, minTargets: null, stretchTargets: null } } }, fixed.id, fixed)).toBe(incline);
		expect(ownTask({ goals: null }, auto.id, auto)).toBeNull();
		// A Slot gone from the plan that the log kept.
		expect(ownTask({ goals: { gone: { taskId: bench, sets: null, targets: null, minTargets: null, stretchTargets: null } } }, 'gone', undefined)).toBe(bench);
		expect(ownTask({ goals: null }, 'gone', undefined)).toBeNull();
		// Older kept goals have no Task: the Slot's own, as Stats reads them.
		expect(ownTask({ goals: { [fixed.id]: { sets: 4, targets: null, minTargets: null, stretchTargets: null } as never } }, fixed.id, fixed)).toBe(bench);
	});

	it('Pick another, then back to the Task it showed before: an auto-filled Slot keeps that one as its pick', () => {
		const before = picks()[auto.id];
		const next = rerollSlot(app, day(today), auto.id);
		expect(next).not.toBe(before);
		swapSlot(app, day(today), auto.id, before);
		expect(picks()[auto.id]).toBe(before);
	});

	it('a swap with no Task leaves an auto-filled Slot without a pick (the Undo of a swap into one that had none); a fixed Slot refuses it', async () => {
		const { actions } = await import('../../routes/(app)/log/[id]/+page.server');
		const swap = async (fields: Record<string, string>) => {
			const body = new FormData();
			for (const [k, v] of Object.entries(fields)) body.set(k, v);
			const event = { request: new Request('http://x/', { method: 'POST', body }), locals: { account: { id: me } }, params: { id: day(today).id }, cookies: { get: () => undefined } };
			return (await (actions.swap as unknown as (e: unknown) => Promise<unknown>)(event)) as { status?: number; data?: { error: string } } | undefined;
		};
		swapSlot(app, day(today), auto.id, incline);
		// It says the pick it took away, for an Undo to put back.
		expect(await swap({ slot: auto.id, task: '' })).toEqual({ was: incline });
		expect(auto.id in picks()).toBe(false);
		expect(await swap({ slot: fixed.id, task: '' })).toMatchObject({ status: 400, data: { error: expect.stringMatching(/own Task/) } });
		expect(() => swapSlot(app, day(today), fixed.id, null)).toThrow(/own Task/);
	});

	it("a finished log refuses a swap and Pick another, so a band's Undo after Finish changes nothing", async () => {
		const { actions } = await import('../../routes/(app)/log/[id]/+page.server');
		const id = randomUUID();
		db.insert(occurrence).values({ id, habitId: gym().id, date: addDays(today, -90), status: 'done', finishedAt: new Date(), variantId: fixed.variantId }).run();
		const post = async (action: 'swap' | 'reroll', fields: Record<string, string>) => {
			const body = new FormData();
			for (const [k, v] of Object.entries(fields)) body.set(k, v);
			const event = { request: new Request('http://x/', { method: 'POST', body }), locals: { account: { id: me } }, params: { id }, cookies: { get: () => undefined } };
			return (await (actions[action] as unknown as (e: unknown) => Promise<unknown>)(event)) as { status?: number; data?: { error: string } } | undefined;
		};
		const picksOf = () => db.select().from(occurrence).where(eq(occurrence.id, id)).get()!.picks;
		const refused = { status: 400, data: { error: 'This log is finished: its Tasks stay as logged.' } };
		expect(await post('swap', { slot: fixed.id, task: incline })).toMatchObject(refused);
		expect(await post('swap', { slot: auto.id, task: '' })).toMatchObject(refused);
		expect(await post('reroll', { slot: auto.id })).toMatchObject(refused);
		expect(picksOf()).toBeNull();
		// Open again, it swaps.
		db.update(occurrence).set({ status: 'due' }).where(eq(occurrence.id, id)).run();
		expect(await post('swap', { slot: fixed.id, task: incline })).toEqual({ was: null });
		expect(picksOf()?.[fixed.id]).toBe(incline);
		db.delete(occurrence).where(eq(occurrence.id, id)).run();
	});

	it('what was done with each Task counts for that Task, and the Slot counts as done', () => {
		const occ = day(today);
		// Two sets of Bench press, then swapped for Incline bench press; the auto-filled Slot done too, with
		// Squat (its pick is random, and Incline there would count for Incline as well).
		swapSlot(app, occ, auto.id, taskId('Squat'));
		set(occ.id, bench, fixed.id, 60, 0);
		set(occ.id, bench, fixed.id, 60, 1);
		set(occ.id, picks()[auto.id], auto.id, 40, 2);
		swapSlot(app, occ, fixed.id, incline);
		// Bench press's sets are the Slot's: the habit isn't short of it, nor of Bench press's 60 kg target.
		expect(progressForIds([occ.id]).get(occ.id)).toEqual({ kind: 'steps', done: 2, total: 2 });
		expect(verdictsFor([occ.id]).get(occ.id)).toBe('full');
		set(occ.id, incline, fixed.id, 50, 3);
		set(occ.id, incline, fixed.id, 50, 4);
		db.update(occurrence).set({ status: 'done', finishedAt: new Date() }).where(eq(occurrence.id, occ.id)).run();
		expect(finishAs(occ.id, today)).toBe('done');

		// Incline's next prefill, Last time and recap are today's.
		const fresh = randomUUID();
		expect(lastEntries(incline, fresh, fixed.id)).toEqual([{ [field(incline, 'Weight')]: 50, [field(incline, 'Reps')]: 8 }, { [field(incline, 'Weight')]: 50, [field(incline, 'Reps')]: 8 }]);
		expect(recapFor(me, [incline], fresh, today)[incline]?.date).toBe(today);
		// Bench press counts the two sets done with it, and nothing of Incline's.
		expect(lastEntries(bench, fresh)).toHaveLength(2);
		expect(recapFor(me, [bench], fresh, today)[bench]?.date).toBe(today);
	});

	it('a swap with nothing done before it leaves the plan\'s Task its last time', () => {
		const tomorrow = addDays(today, 1);
		db.insert(occurrence).values({ id: randomUUID(), habitId: gym().id, date: tomorrow, status: 'due', variantId: fixed.variantId }).run();
		const occ = day(tomorrow);
		swapSlot(app, occ, fixed.id, incline);
		set(occ.id, incline, fixed.id, 52.5, 0);
		db.update(occurrence).set({ status: 'done', finishedAt: new Date() }).where(eq(occurrence.id, occ.id)).run();
		const fresh = randomUUID();
		expect(recapFor(me, [incline], fresh, tomorrow)[incline]?.date).toBe(tomorrow);
		expect(recapFor(me, [bench], fresh, tomorrow)[bench]?.date).toBe(today);
		expect(lastEntries(bench, fresh)[0][field(bench, 'Weight')]).toBe(60);
	});

	it('a finished log keeps its swap when the plan changes, and back to the Task it kept is no swap', () => {
		const occ = day(today);
		db.transaction((tx) => keepGoals(tx, [fixed.variantId]));
		// The plan's Slot uses Squat from now on; today's log keeps Bench press as its own.
		db.update(slot).set({ taskId: taskId('Squat') }).where(eq(slot.id, fixed.id)).run();
		expect(day(today).goals?.[fixed.id]?.taskId).toBe(bench);
		expect(progressForIds([occ.id]).get(occ.id)).toEqual({ kind: 'steps', done: 2, total: 2 });
		expect(verdictsFor([occ.id]).get(occ.id)).toBe('full');
		swapSlot(app, day(today), fixed.id, taskId('Squat'));
		expect(picks()[fixed.id]).toBe(taskId('Squat'));
		swapSlot(app, day(today), fixed.id, bench);
		expect(fixed.id in picks()).toBe(false);
	});
});

describe('the Tasks used in a Slot before, for its ⋯ and the swap picker', () => {
	const log = (date: string, status: 'done' | 'missed', pick: string | null) => {
		const id = randomUUID();
		db.insert(occurrence).values({ id, habitId: gym().id, date, status, variantId: fixed.variantId, picks: pick ? { [fixed.id]: pick } : null }).run();
		return id;
	};

	it('newest first, each Task once, from earlier finished logs of the Variant, with the first set done there', () => {
		const at = (n: number) => addDays(today, -40 + n);
		const squat = taskId('Squat');
		const lunge = taskId('Lunge');
		const first = log(at(0), 'done', incline);
		set(first, incline, fixed.id, 45, 0);
		log(at(1), 'done', squat);
		const newest = log(at(3), 'done', incline);
		// A Slot's once-per-log values come before its sets: the first set is what counts.
		db.insert(entry).values({ id: randomUUID(), occurrenceId: newest, taskId: incline, path: fixed.id, values: { _summary: true }, sortOrder: 0 }).run();
		set(newest, incline, fixed.id, 50, 1);
		set(newest, incline, fixed.id, 52.5, 2);
		// Not counted: a day that was missed, a Task archived since, and anything on or after the day asked about.
		log(at(4), 'missed', taskId('Bench press'));
		const gone = randomUUID();
		db.insert(task).values({ id: gone, accountId: me, name: 'Old press', archived: true }).run();
		log(at(2), 'done', gone);
		log(at(6), 'done', lunge);
		const occ = { id: randomUUID(), variantId: fixed.variantId, date: at(6) };
		const used = usedBefore(occ, fixed.id);
		expect(used.map((u) => [u.taskId, u.date])).toEqual([
			[incline, at(3)],
			[squat, at(1)]
		]);
		expect(used[0].text).toMatch(/^50 kg.*8$/);
		// Squat was swapped in but nothing was logged with it: only the date.
		expect(used[1].text).toBe('');
		expect(usedBefore(occ, fixed.id, 1)).toHaveLength(1);
		// Another Slot, and a day with no Variant, have none.
		expect(usedBefore(occ, auto.id).some((u) => u.taskId === incline)).toBe(false);
		expect(usedBefore({ ...occ, variantId: null }, fixed.id)).toEqual([]);
	});

	it('the picker knows each Task\'s Tags and when it was last done before the log; a Task with parts is not one to show offline', () => {
		const push = randomUUID();
		db.insert(tag).values({ id: push, accountId: me, name: 'Push' }).run();
		db.insert(taskTag).values([{ taskId: bench, tagId: push }, { taskId: incline, tagId: push }]).run();
		const { tags, last } = swapLibrary(me, { id: randomUUID(), date: today });
		expect(tags[bench]).toEqual([push]);
		expect(tags[incline]).toEqual([push]);
		expect(tags[taskId('Squat')]).toBeUndefined();
		expect(last[bench].date).toBe(today);
		// Before a day, only what was done by then; the log itself never counts. With the first set done that day.
		const yesterday = { date: addDays(today, -1), text: expect.stringMatching(/^57.5 kg.*8$/) };
		expect(swapLibrary(me, { id: randomUUID(), date: addDays(today, -1) }).last[bench]).toEqual(yesterday);
		expect(swapLibrary(me, { id: day(today).id, date: today }).last[bench]).toEqual(yesterday);
		// Done with nothing in sets that day: only the day.
		const rope = randomUUID();
		const done = randomUUID();
		db.insert(task).values({ id: rope, accountId: me, name: 'Rope' }).run();
		db.insert(occurrence).values({ id: done, habitId: gym().id, date: addDays(today, -60), status: 'done' }).run();
		db.insert(entry).values({ id: randomUUID(), occurrenceId: done, taskId: rope, path: null, values: { _summary: true, feel: 'easy' } }).run();
		expect(swapLibrary(me, { id: randomUUID(), date: today }).last[rope]).toEqual({ date: addDays(today, -60), text: '' });
		expect(swapLibrary(me, { id: randomUUID(), date: today }).last[taskId('Lunge')]).toBeUndefined();
		expect(hasParts(bench)).toBe(false);
		const part = randomUUID();
		const circuit = taskId('Lunge');
		db.insert(taskPart).values({ id: part, taskId: circuit, childTaskId: taskId('Squat') }).run();
		expect(hasParts(circuit)).toBe(true);
		db.update(taskPart).set({ archived: true }).where(eq(taskPart.id, part)).run();
		expect(hasParts(circuit)).toBe(false);
	});

	it("an open log's fixed Slot lists them, less the plan's Task and the one in use, and holds the fields of those its ⋯ shows", async () => {
		const { load } = await import('../../routes/(app)/log/[id]/+page.server');
		const open = (id: string) =>
			(load as unknown as (e: unknown) => { items: { slotId: string; own: string | null; task: { id: string } | null; used: { taskId: string }[] }[]; alts: Record<string, { task: { id: string }; previous: unknown[] }>; library: { id: string; last: unknown }[] })({
				locals: { account: { id: me } },
				params: { id },
				cookies: { get: () => undefined },
				url: new URL(`http://x/log/${id}`)
			});
		// The plan's Slot uses Squat by now; this day, 30 days back and still open, swapped it for Bench press.
		const id = randomUUID();
		db.insert(occurrence).values({ id, habitId: gym().id, date: addDays(today, -30), status: 'due', variantId: fixed.variantId, picks: { [fixed.id]: bench } }).run();
		const data = open(id);
		const slotOf = (s: string) => data.items.find((it) => it.slotId === s)!;
		expect(slotOf(fixed.id)).toMatchObject({ own: taskId('Squat'), task: { id: bench } });
		expect(slotOf(fixed.id).used.map((u) => u.taskId)).toEqual([taskId('Lunge'), incline]);
		// The plan's Task and the 2 the ⋯ shows can be swapped to at once, also offline.
		expect(Object.keys(data.alts).sort()).toEqual([incline, taskId('Lunge'), taskId('Squat')].sort());
		expect(data.alts[incline].previous.length).toBeGreaterThan(0);
		// An auto-filled Slot picks from its Fill rule: it lists none.
		expect(slotOf(auto.id).used).toEqual([]);
		// The picker's "Last 50 kg × 8": the first set of the day each Task was last done, before this one.
		expect(data.library.find((l) => l.id === incline)?.last).toEqual({ date: addDays(today, -37), text: expect.stringMatching(/^50 kg.*8$/) });
		expect(data.library.find((l) => l.id === bench)?.last).toBeNull();
		// A finished log swaps nothing.
		db.update(occurrence).set({ status: 'done' }).where(eq(occurrence.id, id)).run();
		expect(open(id).alts).toEqual({});
		expect(open(id).items.every((it) => !it.used.length)).toBe(true);
	});

	it('the parts of a Task with parts swapped away are done in its Slot, named, steps too; only what sits nowhere is no longer in the habit', async () => {
		const { load } = await import('../../routes/(app)/log/[id]/+page.server');
		const id = randomUUID();
		const upper = randomUUID();
		const step = randomUUID();
		const old = randomUUID();
		db.insert(task).values([
			{ id: upper, accountId: me, name: 'Upper circuit' },
			{ id: step, accountId: me, name: 'Arm circles', parentTaskId: upper, rowOne: 'round', rowMany: 'rounds' },
			{ id: old, accountId: me, name: 'Old thing' }
		]).run();
		// Round 1 of Upper circuit, then swapped for Bench press: its parts sit under the Slot. A value at a Slot the plan no
		// longer has sits nowhere (a value with no path would read as a Task added to this log, depending on the day).
		db.insert(occurrence).values({ id, habitId: gym().id, date: addDays(today, -95), status: 'due', variantId: fixed.variantId, picks: { [fixed.id]: bench } }).run();
		db.insert(entry).values([
			{ id: randomUUID(), occurrenceId: id, taskId: step, path: `${fixed.id}#1/p1`, values: { done: true }, sortOrder: 0 },
			{ id: randomUUID(), occurrenceId: id, taskId: incline, path: `${fixed.id}#1/p2`, values: { [field(incline, 'Weight')]: 40 }, sortOrder: 1 },
			{ id: randomUUID(), occurrenceId: id, taskId: old, path: randomUUID(), values: { note: 'x' }, sortOrder: 2 }
		]).run();
		const data = (load as unknown as (e: unknown) => { orphanNames: string[]; orphanTasks: Record<string, { name: string; rowOne: string; rowMany: string }> })({
			locals: { account: { id: me } },
			params: { id },
			cookies: { get: () => undefined },
			url: new URL(`http://x/log/${id}`)
		});
		expect(data.orphanNames).toEqual(['Old thing']);
		expect(data.orphanTasks[step]).toEqual({ name: 'Arm circles', rowOne: 'round', rowMany: 'rounds' });
		expect(data.orphanTasks[incline].name).toBe('Incline bench press');
	});
});

describe('Keep in the plan and Replace…: what the Task kept aims for, as one change to the plan', () => {
	let push: string;
	let mine: typeof slot.$inferSelect;
	let filled: typeof slot.$inferSelect;
	let pin: string;
	const pushDay = () => db.select().from(occurrence).where(and(eq(occurrence.habitId, push), eq(occurrence.date, today))).get()!;
	const aim = async (fields: Record<string, string>, occ = pushDay().id) => {
		const { actions } = await import('../../routes/(app)/log/[id]/+page.server');
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		const event = { request: new Request('http://x/', { method: 'POST', body }), locals: { account: { id: me } }, params: { id: occ }, cookies: { get: () => undefined } };
		return (await (actions.aim as unknown as (e: unknown) => Promise<unknown>)(event)) as { targets?: Record<string, number>; aim?: string; status?: number; data?: { error: string } };
	};

	beforeAll(() => {
		runAction(app, 'setup', {
			changes: [
				lift('Floor press'),
				lift('Pin press'),
				{ op: 'add_task', task: { name: 'Plank hold', metrics: [{ name: 'Time', type: 'duration', repeats: true }] } },
				{
					op: 'add_habit',
					habit: {
						name: 'Push',
						startDate: addDays(today, -5),
						schedule: { kind: 'interval', every: 1 },
						variants: [{ name: 'Push day B', slots: [{ taskId: 'Floor press', sets: 4, targets: { Weight: 60 } }, { taskId: null, fillRule: {} }] }]
					}
				}
			],
			apply: true
		});
		push = db.select().from(habit).where(and(eq(habit.accountId, me), eq(habit.name, 'Push'))).get()!.id;
		const v = db.select().from(variant).where(eq(variant.habitId, push)).get()!;
		[mine, filled] = db.select().from(slot).where(eq(slot.variantId, v.id)).orderBy(slot.sortOrder).all();
		pin = taskId('Pin press');
		// With levels, the Slot aims for a Minimum and a Stretch too.
		db.update(habit).set({ levels: { enabled: true, minimum: 'Easy', target: 'Usual', stretch: 'Hard' } }).where(eq(habit.id, push)).run();
		const fw = field(taskId('Floor press'), 'Weight');
		db.update(slot).set({ minTargets: { [fw]: 50 }, stretchTargets: { [fw]: 65 } }).where(eq(slot.id, mine.id)).run();
		// Pin press last time, 3 days back: 55, 57.5, 57.5 kg.
		const past = randomUUID();
		db.insert(occurrence).values({ id: past, habitId: push, date: addDays(today, -3), status: 'done', finishedAt: new Date(), variantId: v.id }).run();
		[55, 57.5, 57.5].forEach((kg, n) => set(past, pin, mine.id, kg, n));
		runAction(app, 'today', {});
	});

	it("aims for what most of today's sets used, on a tie the last one's, only where the old Task had a target; the Slot's sets stay", async () => {
		const w = field(pin, 'Weight');
		const r = field(pin, 'Reps');
		const today = [50, 52.5, 52.5, 50].map((kg) => ({ [w]: kg, [r]: 8 }));
		expect(await aim({ slot: mine.id, task: pin, today: JSON.stringify(today) })).toEqual({ targets: { [w]: 50 }, aim: '4 × 50 kg' });
	});
	it('with nothing done today, its last time; a Task with no field like the old target, none', async () => {
		expect(await aim({ slot: mine.id, task: pin, today: '[]' })).toEqual({ targets: { [field(pin, 'Weight')]: 57.5 }, aim: '4 × 57.5 kg' });
		// Nothing sent, or nothing it can read, is nothing done today.
		expect((await aim({ slot: mine.id, task: pin, today: 'not json' })).targets).toEqual({ [field(pin, 'Weight')]: 57.5 });
		expect(await aim({ slot: mine.id, task: taskId('Plank hold') })).toEqual({ targets: {}, aim: '' });
	});
	it('is never for an auto-filled Slot, nor for a Slot of another Variant or a Task of another account', async () => {
		expect(await aim({ slot: filled.id, task: pin })).toMatchObject({ status: 400, data: { error: expect.stringMatching(/rule/) } });
		await expect(aim({ slot: fixed.id, task: pin })).rejects.toMatchObject({ status: 404 });
		await expect(aim({ slot: mine.id, task: randomUUID() })).rejects.toMatchObject({ status: 404 });
		// A part inside a Task is no Slot's Task, as a swap refuses it.
		const part = randomUUID();
		db.insert(task).values({ id: part, accountId: me, name: 'Pin press lockout', parentTaskId: pin }).run();
		await expect(aim({ slot: mine.id, task: part })).rejects.toMatchObject({ status: 404 });
	});
	it('Keep changes this Slot only, clears Minimum and Stretch, and its Undo puts the Slot back exactly; today stays on the Task swapped in', async () => {
		const { currentForm, patchHabit } = await import('./habit-patch');
		const { withSlot, slotIn } = await import('$lib/log/plan');
		swapSlot(app, pushDay(), mine.id, pin);
		const before = currentForm(me, push)!.variants;
		const { targets } = await aim({ slot: mine.id, task: pin, today: '[]' });
		const kept = withSlot(before, mine.id, { taskId: pin, targets, minTargets: {}, stretchTargets: {} });
		expect(patchHabit(me, push, { set: { variants: kept }, was: { variants: before }, applies: 'today', keep: false }, today)).not.toHaveProperty('error');
		const now = currentForm(me, push)!.variants;
		expect(slotIn(now, mine.id)).toMatchObject({ taskId: pin, sets: 4, targets: { [field(pin, 'Weight')]: 57.5 }, minTargets: {}, stretchTargets: {} });
		expect(slotIn(now, filled.id)).toEqual(slotIn(before, filled.id));
		expect(ownTask(pushDay(), mine.id, db.select().from(slot).where(eq(slot.id, mine.id)).get())).toBe(pin);
		// Undo: the reverse change, as the band sends it.
		const back = patchHabit(me, push, { set: { variants: before }, was: { variants: kept }, applies: 'today', keep: false }, today);
		expect(back).not.toHaveProperty('moved');
		expect(currentForm(me, push)!.variants).toEqual(before);
		expect(slotIn(before, mine.id)).toMatchObject({ taskId: taskId('Floor press'), minTargets: { [field(taskId('Floor press'), 'Weight')]: 50 }, stretchTargets: { [field(taskId('Floor press'), 'Weight')]: 65 } });
		expect(pushDay().picks?.[mine.id]).toBe(pin);
	});
	it("Replace… after a Keep: the log swaps back to the Slot's own Task first, which drops the pick Keep left, so today follows the plan; its Undo puts the pick back", async () => {
		const { currentForm, patchHabit } = await import('./habit-patch');
		const { withSlot } = await import('$lib/log/plan');
		const { positionsOf } = await import('./positions');
		const plank = taskId('Plank hold');
		swapSlot(app, pushDay(), mine.id, pin);
		const before = currentForm(me, push)!.variants;
		const change = (set: typeof before, was: typeof before) => expect(patchHabit(me, push, { set: { variants: set }, was: { variants: was }, applies: 'today', keep: false }, today)).not.toHaveProperty('error');
		const kept = withSlot(before, mine.id, { taskId: pin, targets: {}, minTargets: {}, stretchTargets: {} });
		change(kept, before);
		// Kept: the pick stays (Keep's Undo needs it), and is now the Slot's own Task.
		expect(pushDay().picks?.[mine.id]).toBe(pin);
		// Replace…: back to the Slot's own Task, which says the pick it dropped, then the plan changes.
		expect(swapSlot(app, pushDay(), mine.id, pin)).toBe(pin);
		expect(pushDay().picks?.[mine.id]).toBeUndefined();
		const replaced = withSlot(kept, mine.id, { taskId: plank, targets: {}, minTargets: {}, stretchTargets: {} });
		change(replaced, kept);
		const shown = () => positionsOf(pushDay()).find((p) => p.slotId === mine.id)?.taskId;
		expect(shown()).toBe(plank);
		// Its Undo: the pick back while the plan still names Plank hold, then the plan back, and today with it.
		expect(swapSlot(app, pushDay(), mine.id, pin)).toBeUndefined();
		change(kept, replaced);
		expect(shown()).toBe(pin);
		expect(pushDay().picks?.[mine.id]).toBe(pin);
		// Then Keep's Undo: the plan back, and today stays on the Task the user was doing.
		change(before, kept);
		expect(currentForm(me, push)!.variants).toEqual(before);
		expect(shown()).toBe(pin);
	});
	it("History: a day swapped before a Keep still names the Task it was done instead of; one done after, with the Task kept, reads plain", async () => {
		const { currentForm, patchHabit } = await import('./habit-patch');
		const { withSlot } = await import('$lib/log/plan');
		const { load } = await import('../../routes/(app)/history/+page.server');
		const history = () => (load as unknown as (e: unknown) => { values: Record<string, string[]> })({ locals: { account: { id: me } }, cookies: { get: () => undefined }, url: new URL('http://x/history') }).values;
		const floor = taskId('Floor press');
		const done = (date: string, picks: Record<string, string> | null, t: string) => {
			const id = randomUUID();
			db.insert(occurrence).values({ id, habitId: push, date, status: 'done', finishedAt: new Date(), variantId: mine.variantId, picks }).run();
			set(id, t, mine.id, 55, 0);
			return id;
		};
		const swapped = done(addDays(today, -20), { [mine.id]: pin }, pin);
		const planned = done(addDays(today, -19), null, floor);
		const before = currentForm(me, push)!.variants;
		const kept = withSlot(before, mine.id, { taskId: pin, targets: {}, minTargets: {}, stretchTargets: {} });
		expect(patchHabit(me, push, { set: { variants: kept }, was: { variants: before }, applies: 'today', keep: false }, today)).not.toHaveProperty('error');
		const after = done(addDays(today, -18), null, pin);
		const names = (id: string) => history()[id].map((l) => l.slice(0, l.indexOf(':')));
		expect(names(swapped)).toEqual(['Pin press · instead of Floor press']);
		expect(names(planned)).toEqual(['Floor press']);
		expect(names(after)).toEqual(['Pin press']);
		patchHabit(me, push, { set: { variants: before }, was: { variants: kept }, applies: 'today', keep: false }, today);
	});
});

describe('a past log says what was done instead of the plan', () => {
	it("History names the plan's Task a swapped-in Task replaced; sets done before the swap, an auto-filled pick and a kept swap read plain", async () => {
		const { load } = await import('../../routes/(app)/history/+page.server');
		const history = () =>
			(load as unknown as (e: unknown) => { values: Record<string, string[]> })({ locals: { account: { id: me } }, cookies: { get: () => undefined }, url: new URL('http://x/history') });
		const goal = (sortOrder: number, t: string | null) => ({ sortOrder, taskId: t, sets: 4, targets: null, minTargets: null, stretchTargets: null });
		const lunge = taskId('Lunge');
		// 60 days back the plan had Bench press: one set of it, then Incline bench press for the rest; the auto-filled Slot picked Lunge.
		const swapped = randomUUID();
		db.insert(occurrence).values({ id: swapped, habitId: gym().id, date: addDays(today, -60), status: 'done', variantId: fixed.variantId, picks: { [fixed.id]: incline, [auto.id]: lunge }, goals: { [fixed.id]: goal(0, bench), [auto.id]: goal(1, null) } }).run();
		set(swapped, bench, fixed.id, 60, 0);
		set(swapped, incline, fixed.id, 50, 1);
		set(swapped, incline, fixed.id, 50, 2);
		set(swapped, lunge, auto.id, 20, 3);
		// The day after, the pick is the plan's own Task now: kept in the plan, it is no swap.
		const kept = randomUUID();
		const plan = db.select().from(slot).where(eq(slot.id, fixed.id)).get()!.taskId!;
		db.insert(occurrence).values({ id: kept, habitId: gym().id, date: addDays(today, -59), status: 'done', variantId: fixed.variantId, picks: { [fixed.id]: plan } }).run();
		set(kept, plan, fixed.id, 70, 0);
		const { values } = history();
		const names = (id: string) => values[id].map((l) => l.slice(0, l.indexOf(':')));
		expect(names(swapped)).toEqual(['Bench press', 'Incline bench press · instead of Bench press', 'Lunge']);
		expect(values[swapped][1]).toMatch(/50 kg.*, 50 kg/);
		expect(names(kept)).toEqual([db.select().from(task).where(eq(task.id, plan)).get()!.name]);
	});
});
