// Changes the Library and Habits lists make in place in edit mode, against a real (in-memory)
// database: rename and archive (the shared name rule, Library Tasks only, other accounts
// untouched), and moving a habit into and out of a group or routine (the editor's rules).
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { habit, task } from './db/schema';
import { createAccount } from './auth';
import { renameTask, saveTask, setTaskArchived } from './repo/tasks';
import { getHabitForm, saveHabit } from './repo/habits';
import { moveHabit } from './habit-actions';
import { habitForm, taskForm } from '$lib/forms';

let me: string;
let other: string;
let id: string;

const today = '2026-11-22';
const parentOf = (habitId: string) => db.select({ parentId: habit.parentId }).from(habit).where(eq(habit.id, habitId)).get()?.parentId ?? null;
/** A daily tick-off habit (no Tasks, so it can hold habits: a routine once it does). */
function daily(name: string, parentId: string | null = null, follows = false): string {
	const v = randomUUID();
	const schedule = follows ? { kind: 'follow', variantId: v, on: null } : { kind: 'interval', every: 1, start: today, variantId: v };
	return saveHabit(me, null, habitForm.parse({ name, direction: 'build', startDate: today, variants: [{ id: v, name: 'Main', slots: [] }], schedule, parentId }), today)!;
}
const group = (name: string, parentId: string | null = null) =>
	saveHabit(me, null, habitForm.parse({ name, direction: 'build', startDate: today, variants: [], schedule: { kind: 'group', target: null, minimum: null }, parentId }), today)!;

const nameOf = (taskId: string) => db.select({ name: task.name, archived: task.archived }).from(task).where(eq(task.id, taskId)).get();

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('rename', 'correct horse battery');
	other = await createAccount('rename-other', 'correct horse battery');
	id = saveTask(me, null, taskForm.parse({ name: 'Bench press', restTimerEnabled: false, restTimerSeconds: 90, tags: [], metrics: [], parts: [] }))!;
});

describe('renameTask', () => {
	it('renames a Library Task, trimmed', () => {
		expect(renameTask(me, id, '  Bench  ')).toEqual({ name: 'Bench' });
		expect(nameOf(id)?.name).toBe('Bench');
	});
	it('refuses an empty or too long name with the editor’s message', () => {
		expect(renameTask(me, id, '   ')).toEqual({ error: 'A name is required' });
		expect(renameTask(me, id, 'x'.repeat(121))).toEqual({ error: 'Keep names to 120 characters or fewer' });
		expect(nameOf(id)?.name).toBe('Bench');
	});
	it("can't rename another account's Task", () => {
		expect(renameTask(other, id, 'Mine now')).toEqual({ error: 'No such Task' });
		expect(nameOf(id)?.name).toBe('Bench');
	});
});

describe('setTaskArchived', () => {
	it('archives and brings back, and says when there is no such Task', () => {
		expect(setTaskArchived(me, id, true)).toBe(true);
		expect(nameOf(id)?.archived).toBe(true);
		expect(setTaskArchived(other, id, false)).toBe(false);
		expect(nameOf(id)?.archived).toBe(true);
		expect(setTaskArchived(me, id, false)).toBe(true);
		expect(nameOf(id)?.archived).toBe(false);
	});
});

describe('moveHabit', () => {
	it('puts a habit in a group and takes it out again', () => {
		const g = group('Mornings');
		const h = daily('Stretch');
		expect(moveHabit(me, h, g)).toEqual({ parentId: g });
		expect(parentOf(h)).toBe(g);
		expect(moveHabit(me, h, null)).toEqual({ parentId: null });
		expect(parentOf(h)).toBeNull();
	});
	it('keeps the editor’s rules: groups only in groups, no loops, not into a habit with Tasks', () => {
		const outer = group('Health');
		const inner = group('Sleep', outer);
		const routine = daily('Wind down');
		expect(moveHabit(me, inner, routine)).toEqual({ error: 'A group can only sit inside another group for now' });
		expect(moveHabit(me, outer, inner)).toEqual({ error: "A habit can't sit inside itself or a habit inside it" });
		const withTask = daily('Journal');
		const f = getHabitForm(me, withTask)!;
		saveHabit(me, withTask, { ...f, variants: f.variants.map((v) => ({ ...v, slots: [{ id: randomUUID(), taskId: null, fillRule: null, sets: null, targets: {}, minTargets: {}, stretchTargets: {} }] })) }, today);
		expect('error' in moveHabit(me, daily('Read'), withTask)).toBe(true);
		expect(parentOf(inner)).toBe(outer);
	});
	it('a habit that follows its routine can’t leave it without a schedule of its own', () => {
		const routine = daily('Evening');
		const kid = daily('Floss', routine, true);
		expect(moveHabit(me, kid, null)).toEqual({ error: 'A habit can only follow a routine it sits in. Put it in a routine, or give it a schedule of its own' });
		expect(parentOf(kid)).toBe(routine);
	});
	it("can't move another account's habit", () => {
		const h = daily('Walk');
		expect(moveHabit(other, h, null)).toEqual({ error: 'No such habit' });
	});
});
