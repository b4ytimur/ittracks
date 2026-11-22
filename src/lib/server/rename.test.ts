// Rename and archive in place (the Library and Habits lists in edit mode) against a real
// (in-memory) database: the shared name rule, Library Tasks only, and other accounts untouched.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { task } from './db/schema';
import { createAccount } from './auth';
import { renameTask, saveTask, setTaskArchived } from './repo/tasks';
import { taskForm } from '$lib/forms';

let me: string;
let other: string;
let id: string;

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
