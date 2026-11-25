// One line of a habit at a time: nothing else is touched, an old page never overwrites, and a change
// that rewrites past days can be taken back exactly, without losing what was logged since.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { asc, eq } from 'drizzle-orm';
import { db } from './db';
import { entry, habit, occurrence, task } from './db/schema';
import { createAccount } from './auth';
import { saveHabit, variantForms } from './repo/habits';
import { occurrenceOn } from './backfill';
import { saveTask } from './repo/tasks';
import { currentForm, habitPatch, patchHabit } from './habit-patch';
import { restoreSnapshot, withSnapshot } from './snapshot';
import { settle } from './today';
import { habitForm, taskForm, type ScheduleForm } from '$lib/forms';

let me: string;
let other: string;
let id: string;
let v: string;
const today = '2026-11-22';
const patch = (set: Record<string, unknown>, was: Record<string, unknown>, o: Record<string, unknown> = {}, who = me) => patchHabit(who, id, habitPatch.parse({ set, was, ...o }), today);
const form = () => currentForm(me, id)! as Record<string, unknown> & ReturnType<typeof currentForm> & object;
const days = () => db.select().from(occurrence).where(eq(occurrence.habitId, id)).orderBy(asc(occurrence.date)).all();
const daily = (): ScheduleForm => ({ kind: 'interval', every: 1, start: '2026-11-01', variantId: v });

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('patch', 'correct horse battery');
	other = await createAccount('patch-other', 'correct horse battery');
});
beforeEach(() => {
	v = crypto.randomUUID();
	id = saveHabit(me, null, habitForm.parse({ name: 'Read', direction: 'build', startDate: '2026-11-01', variants: [{ id: v, name: 'Main', slots: [] }], schedule: daily() }), today)!;
	settle(me, id, daily(), today);
});

describe('a change to one line', () => {
	it('sets its fields and leaves the rest', () => {
		const before = form();
		const r = patch({ reframe: 'I get to read' }, { reframe: before.reframe });
		expect(r).toMatchObject({ form: { reframe: 'I get to read' } });
		expect({ ...form(), reframe: before.reframe }).toEqual(before);
	});

	it('is refused when the field changed since, and only then', () => {
		const was = form();
		patch({ name: 'Read more' }, { name: 'Read' });
		expect(patch({ name: 'Read less' }, { name: was.name })).toMatchObject({ moved: { name: 'Read more' } });
		expect(form().name).toBe('Read more');
		// Another field of the same habit still saves, and asking for what is there is no conflict.
		expect(patch({ reframe: 'x' }, { reframe: was.reframe })).toHaveProperty('form');
		expect(patch({ name: 'Read more' }, { name: was.name })).toHaveProperty('form');
	});

	it('is checked like the whole form, and changes nothing when refused', () => {
		const before = form();
		expect(patch({ name: '' }, { name: before.name })).toHaveProperty('error');
		expect(patch({ direction: 'break' }, { direction: 'build' }, {}, other)).toMatchObject({ status: 404 });
		expect(patch({ nonsense: 1 }, {})).toHaveProperty('error');
		expect(form()).toEqual(before);
	});

	it('keeps a Slot added to a Variant', () => {
		const t = saveTask(me, null, taskForm.parse({ name: `Pages ${id}`, restTimerEnabled: false, restTimerSeconds: 90, tags: [], metrics: [], parts: [] }))!;
		const variants = structuredClone(form().variants);
		variants[0].slots.push({ id: crypto.randomUUID(), taskId: t, fillRule: null, sets: null, targets: {}, minTargets: {}, stretchTargets: {} });
		expect(patch({ variants }, { variants: form().variants })).toHaveProperty('form');
		expect(form().variants[0].slots.map((s) => s.taskId)).toEqual([t]);
		expect(db.select().from(task).where(eq(task.id, t)).get()).toBeTruthy();
	});
});

describe('Variants', () => {
	const slotOf = (taskId: string) => ({ id: crypto.randomUUID(), taskId, fillRule: null, sets: 3, targets: {}, minTargets: {}, stretchTargets: {} });
	const library = (who: string) => saveTask(who, null, taskForm.parse({ name: `Row ${crypto.randomUUID()}`, restTimerEnabled: false, restTimerSeconds: 90, tags: [], metrics: [], parts: [] }))!;

	it('are archived when something was logged on them, deleted when not, and can come back', () => {
		const t = library(me);
		const [b, c] = [crypto.randomUUID(), crypto.randomUUID()];
		const three = [...form().variants, { id: b, name: 'B', slots: [slotOf(t)] }, { id: c, name: 'C', slots: [] }];
		patch({ variants: three }, { variants: form().variants });
		const day = days().at(-1)!;
		db.update(occurrence).set({ variantId: b, status: 'done' }).where(eq(occurrence.id, day.id)).run();
		const r = patch({ variants: [three[0]] }, { variants: form().variants }, { keep: true }) as { undo: string };
		expect(form().variants.map((x) => x.name)).toEqual(['Main']);
		expect(variantForms(id, true).map((x) => [x.name, x.slots.length])).toEqual([['B', 1]]);
		expect(days().find((o) => o.id === day.id)!.variantId).toBe(b);
		// Not offered for a new log, but a past day of its keeps it.
		expect(occurrenceOn(me, db.select().from(habit).where(eq(habit.id, id)).get()!, day.date, null)!.variantId).toBe(b);
		expect(restoreSnapshot(me, r.undo)).toBe(true);
		expect(form().variants.map((x) => x.name)).toEqual(['Main', 'B', 'C']);
		patch({ variants: [three[0]] }, { variants: form().variants });
		patch({ variants: [three[0], ...variantForms(id, true)] }, { variants: form().variants });
		expect(form().variants.map((x) => [x.name, x.slots.length])).toEqual([['Main', 0], ['B', 1]]);
		expect(variantForms(id, true)).toEqual([]);
	});

	it("are never another habit's, and their Tasks are this account's", () => {
		const own = crypto.randomUUID();
		const theirs = saveHabit(other, null, habitForm.parse({ name: 'Theirs', direction: 'build', startDate: '2026-11-01', variants: [{ id: own, name: 'Mine', slots: [slotOf(library(other))] }], schedule: { ...daily(), variantId: own } }), today)!;
		const [their] = variantForms(theirs);
		const was = { variants: form().variants };
		const main = was.variants[0];
		expect(patch({ variants: [main, { ...their, name: 'Taken', slots: [] }] }, was)).toHaveProperty('error');
		expect(patch({ variants: [{ ...main, slots: [their.slots[0]] }] }, was)).toHaveProperty('error');
		expect(patch({ variants: [{ ...main, slots: [slotOf(their.slots[0].taskId!)] }] }, was)).toHaveProperty('error');
		expect(variantForms(theirs)).toEqual([their]);
		expect(form().variants).toEqual(was.variants);
	});
});

describe('taking back a change that rewrote past days', () => {
	const weekly = (): ScheduleForm => ({ kind: 'weekly', days: { '0': v } });

	it('puts every day back as it was', () => {
		const before = days();
		expect(before.length).toBe(21);
		const r = patch({ schedule: weekly() }, { schedule: form().schedule }, { applies: 'past', keep: true }) as { undo: string };
		settle(me, id, weekly(), today);
		expect(days().length).toBeLessThan(21);
		expect(restoreSnapshot(other, r.undo)).toBe(false);
		expect(restoreSnapshot(me, r.undo)).toBe(true);
		expect(form().schedule).toEqual(daily());
		const strip = (xs: typeof before) => xs.map((o) => [o.date, o.status, o.variantId]);
		expect(strip(days())).toEqual(strip(before));
		expect(restoreSnapshot(me, r.undo)).toBe(false);
	});

	it('takes away the misses the other plan counted since', () => {
		patch({ schedule: weekly() }, { schedule: daily() }, { applies: 'past' });
		settle(me, id, weekly(), today);
		const before = days().map((o) => [o.date, o.status]);
		const r = patch({ schedule: daily() }, { schedule: form().schedule }, { applies: 'past', keep: true }) as { undo: string };
		settle(me, id, daily(), today);
		expect(days().length).toBeGreaterThan(before.length);
		expect(restoreSnapshot(me, r.undo)).toBe(true);
		settle(me, id, weekly(), today);
		expect(days().map((o) => [o.date, o.status])).toEqual(before);
	});

	it('keeps what was logged since', () => {
		const r = patch({ schedule: weekly() }, { schedule: form().schedule }, { applies: 'past', keep: true }) as { undo: string };
		settle(me, id, weekly(), today);
		const monday = days().find((o) => o.date === '2026-11-16')!;
		db.update(occurrence).set({ status: 'done', finishedAt: new Date() }).where(eq(occurrence.id, monday.id)).run();
		db.insert(occurrence).values({ id: crypto.randomUUID(), habitId: id, date: today, status: 'done', extra: true }).run();
		expect(restoreSnapshot(me, r.undo)).toBe(true);
		expect(days().find((o) => o.date === '2026-11-16')?.status).toBe('done');
		expect(days().find((o) => o.date === today)?.status).toBe('done');
	});

	it('is refused once a day was logged on a Variant that came with it', () => {
		const extra = { id: crypto.randomUUID(), name: 'Short', slots: [] };
		const r = patch({ variants: [...form().variants, extra] }, { variants: form().variants }, { keep: true }) as { undo: string };
		db.insert(occurrence).values({ id: crypto.randomUUID(), habitId: id, variantId: extra.id, date: today, status: 'done', extra: true }).run();
		expect(restoreSnapshot(me, r.undo)).toBe(false);
		expect(days().some((o) => o.variantId === extra.id)).toBe(true);
	});

	it('is refused once the habit was changed again', () => {
		const r = patch({ schedule: weekly() }, { schedule: form().schedule }, { applies: 'past', keep: true }) as { undo: string };
		patch({ name: 'Other' }, { name: 'Read' });
		expect(restoreSnapshot(me, r.undo)).toBe(false);
		expect(form().schedule).toEqual(weekly());
	});

	it('brings back a Variant and its Slots with their logs still on it', () => {
		const b = crypto.randomUUID();
		const two = [...form().variants, { id: b, name: 'B', slots: [] }];
		patch({ variants: two }, { variants: form().variants });
		const o = days()[3];
		db.update(occurrence).set({ variantId: b, status: 'done' }).where(eq(occurrence.id, o.id)).run();
		const one = [form().variants[0]];
		const r = patch({ variants: one }, { variants: form().variants }, { keep: true }) as { undo: string };
		expect(days()[3].variantId).toBe(b);
	expect(form().variants.map((x) => x.id)).toEqual([v]);
		expect(restoreSnapshot(me, r.undo)).toBe(true);
		expect(form().variants.map((x) => x.id)).toEqual([v, b]);
		expect(days()[3].variantId).toBe(b);
	});

	it('also puts back the days of what it sits in', () => {
		const g = saveHabit(me, null, habitForm.parse({ name: 'Week', direction: 'build', startDate: '2026-11-01', variants: [], schedule: { kind: 'group', target: null, minimum: null } }), today)!;
		patch({ parentId: g }, { parentId: null });
		const groupDays = () => db.select({ d: occurrence.date, s: occurrence.status }).from(occurrence).where(eq(occurrence.habitId, g)).orderBy(asc(occurrence.date)).all();
		const before = groupDays();
		const { undo } = withSnapshot(me, id, () => {
			db.update(occurrence).set({ status: 'done' }).where(eq(occurrence.habitId, g)).run();
			db.update(habit).set({ name: 'x' }).where(eq(habit.id, id)).run();
		});
		expect(restoreSnapshot(me, undo)).toBe(true);
		expect(groupDays()).toEqual(before);
	});
});

it('leaves no entries behind', () => {
	expect(db.select().from(entry).all()).toEqual([]);
});

it('takes back a limit of a break habit', () => {
	const b = saveHabit(me, null, habitForm.parse({ name: 'No smoking', direction: 'break', startDate: '2026-10-01', variants: [], schedule: null }), today)!;
	const f = currentForm(me, b)!;
	const r = patchHabit(me, b, habitPatch.parse({ set: { limit: { max: 3, period: 'day', taper: null, start: '2026-10-01' } }, was: { limit: f.limit }, keep: true }), today) as { undo: string };
	expect(restoreSnapshot(me, r.undo)).toBe(true);
	expect(currentForm(me, b)!.limit).toBeNull();
});
