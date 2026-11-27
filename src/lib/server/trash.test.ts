// Delete, put back (for a day), and gone for good after that; Areas and identities with their links.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { habit, habitIdentity, identity, task } from './db/schema';
import { createAccount } from './auth';
import { listTasks, saveTask, setTaskArchived } from './repo/tasks';
import { unarchiveHabit } from './habit-actions';
import { listHabits, saveHabit } from './repo/habits';
import { addArea, changeArea, deleteArea, listAreas, moveAreas, restoreArea } from './repo/areas';
import { deleteIdentity, identityFor, restoreIdentity } from './repo/identities';
import { KEEP_MS, sweep, trash, untrash } from './trash';
import { habitForm, taskForm } from '$lib/forms';
import { groupBy } from '$lib/views';

let me: string;
let other: string;
const today = '2026-11-22';
const newTask = (name: string) => saveTask(me, null, taskForm.parse({ name, restTimerEnabled: false, restTimerSeconds: 90, tags: [], metrics: [], parts: [] }))!;
const newHabit = (name: string) =>
	saveHabit(me, null, habitForm.parse({ name, direction: 'build', startDate: today, variants: [{ id: crypto.randomUUID(), name: 'Main', slots: [] }], schedule: { kind: 'group', target: null, minimum: null } }), today)!;

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('trash', 'correct horse battery');
	other = await createAccount('trash-other', 'correct horse battery');
});

describe('deleting', () => {
	it('hides a Task at once, also from the archive, and puts it back', () => {
		const id = newTask('Bench press');
		expect(trash(other, 'task', id, today)).toBeNull();
		expect(trash(me, 'task', id, today)).toEqual({ archived: false });
		expect(trash(me, 'task', id, today)).toBeNull();
		expect(listTasks(me, { archived: true }).some((t) => t.id === id)).toBe(false);
		// Kept a day, listed with the archived ones to be put back.
		const listed = listTasks(me, { archived: true, deleted: true }).find((t) => t.id === id);
		expect(listed?.archived).toBe(true);
		expect(listed!.deleteAfter!.getTime() - Date.now()).toBeGreaterThan(KEEP_MS - 60_000);
		expect(KEEP_MS).toBe(24 * 3600_000);
		expect(untrash(other, 'task', id, false, today)).toBe(false);
		expect(untrash(me, 'task', id, false, today)).toBe(true);
		expect(listTasks(me).some((t) => t.id === id)).toBe(true);
	});

	it('brings an archived habit back archived', () => {
		const id = newHabit('Old');
		db.update(habit).set({ archived: true }).where(eq(habit.id, id)).run();
		expect(trash(me, 'habit', id, today)).toEqual({ archived: true });
		expect(listHabits(me, { archived: true }).some((h) => h.id === id)).toBe(false);
		expect(listHabits(me, { archived: true, deleted: true }).find((h) => h.id === id)?.deleteAfter).toBeInstanceOf(Date);
		expect(untrash(me, 'habit', id, true, today)).toBe(true);
		expect(listHabits(me, { archived: true, deleted: true }).find((h) => h.id === id)?.deleteAfter).toBeNull();
		expect(listHabits(me, { archived: true }).find((h) => h.id === id)?.archived).toBe(true);
	});

	it('is not deleted when it was brought back some other way', () => {
		const h = newHabit('Kept');
		const t = newTask('Kept too');
		const at = Date.now();
		trash(me, 'habit', h, today, at);
		trash(me, 'task', t, today, at);
		unarchiveHabit(me, h, today);
		setTaskArchived(me, t, false);
		sweep(at + KEEP_MS + 2000);
		expect(listHabits(me).some((x) => x.id === h)).toBe(true);
		expect(listTasks(me).some((x) => x.id === t)).toBe(true);
	});

	it('is gone for good after its time, and not before', () => {
		const h = newHabit('Gone');
		const t = newTask('Gone too');
		const at = Date.now();
		trash(me, 'habit', h, today, at);
		trash(me, 'task', t, today, at);
		expect(sweep(at + KEEP_MS - 2000)).toBe(0);
		expect(sweep(at + KEEP_MS + 2000)).toBe(2);
		expect(db.select().from(habit).where(eq(habit.id, h)).get()).toBeUndefined();
		expect(db.select().from(task).where(eq(task.id, t)).get()).toBeUndefined();
		expect(untrash(me, 'habit', h, false, today)).toBe(false);
	});
});

describe('Areas in place', () => {
	it('deletes and puts back with its id and what it held', () => {
		const id = addArea(me, 'Garden')!.id;
		// Adding it again finds it, and says so: undoing that must not delete what was there.
		expect(addArea(me, 'garden')).toEqual({ id, existed: true });
		const t = newTask('Water plants');
		const moved = newTask('Prune');
		db.update(task).set({ areaId: id }).where(eq(task.id, t)).run();
		db.update(task).set({ areaId: id }).where(eq(task.id, moved)).run();
		expect(deleteArea(other, id)).toBeNull();
		const d = deleteArea(me, id)!;
		expect(listTasks(me).find((x) => x.id === t)?.areaId).toBeNull();
		const elsewhere = listAreas(me)[0].id;
		db.update(task).set({ areaId: elsewhere }).where(eq(task.id, moved)).run();
		restoreArea(me, d);
		expect(listTasks(me).find((x) => x.id === t)?.areaId).toBe(id);
		expect(listTasks(me).find((x) => x.id === moved)?.areaId).toBe(elsewhere);
	});

	it('renames, recolours and reorders only your own', () => {
		const [a, b] = listAreas(me);
		expect(changeArea(me, a.id, { name: ' Body ', color: '#112233' })).toBe(true);
		expect(changeArea(me, a.id, { color: 'red' })).toBe(false);
		expect(changeArea(other, a.id, { name: 'Mine now' })).toBe(false);
		moveAreas(me, [b.id, a.id]);
		expect(listAreas(me).slice(0, 2).map((x) => x.name)).toEqual([b.name, 'Body']);
	});

	it('shows Areas with nothing in them when nothing narrows the list', () => {
		const areas = listAreas(me);
		expect(groupBy([], 'area', { areas })).toEqual([]);
		expect(groupBy([], 'area', { areas }, { keepEmpty: true }).map((g) => g.key)).toEqual(areas.map((a) => a.id));
	});
});

it('puts an identity back with its habits', () => {
	const id = identityFor(me, 'I am a gardener')!;
	const h = newHabit('Garden');
	db.insert(habitIdentity).values({ habitId: h, identityId: id }).run();
	expect(deleteIdentity(other, id)).toBeNull();
	restoreIdentity(me, deleteIdentity(me, id)!);
	expect(db.select().from(identity).where(eq(identity.id, id)).get()?.statement).toBe('I am a gardener');
	expect(db.select().from(habitIdentity).where(eq(habitIdentity.identityId, id)).all()).toEqual([{ habitId: h, identityId: id }]);
});
