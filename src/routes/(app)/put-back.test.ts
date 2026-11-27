// Put back, from a deleted habit's or Task's ⋯, and its Undo: the page's own delete action, so it is deleted again, not
// only archived. Against a real (in-memory) database.
import { beforeAll, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from '$lib/server/db';
import { createAccount } from '$lib/server/auth';
import { listHabits, saveHabit } from '$lib/server/repo/habits';
import { listTasks, saveTask } from '$lib/server/repo/tasks';
import { trash } from '$lib/server/trash';
import { habitForm, taskForm } from '$lib/forms';

let me: string;
const today = '2026-11-22';

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('put-back', 'correct horse battery');
});

/** Post a page's form action, as the band's Undo does. */
async function post(actions: Record<string, unknown>, name: string, fields: Record<string, string>, params: Record<string, string> = {}) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	const event = { request: new Request('http://x/', { method: 'POST', body }), locals: { account: { id: me } }, params, cookies: { get: () => undefined } };
	return (actions[name] as (e: unknown) => unknown)(event);
}

it('a habit put back, then Undo: deleted again', async () => {
	const id = saveHabit(me, null, habitForm.parse({ name: 'Run', direction: 'build', startDate: today, variants: [{ id: crypto.randomUUID(), name: 'Main', slots: [] }], schedule: { kind: 'group', target: null, minimum: null } }), today)!;
	trash(me, 'habit', id, today);
	const row = () => listHabits(me, { archived: true, deleted: true }).find((h) => h.id === id)!;
	await post((await import('./habits/+page.server')).actions, 'unarchive', { id });
	expect(row()).toMatchObject({ archived: false, deleteAfter: null });
	expect(await post((await import('./habits/[id]/+page.server')).actions, 'delete', {}, { id })).toEqual({ deleted: { archived: false } });
	expect(row().archived).toBe(true);
	expect(row().deleteAfter).toBeInstanceOf(Date);
});

it('a Task put back, then Undo: deleted again', async () => {
	const id = saveTask(me, null, taskForm.parse({ name: 'Bench press', restTimerEnabled: false, restTimerSeconds: 90, tags: [], metrics: [], parts: [] }))!;
	trash(me, 'task', id, today);
	const row = () => listTasks(me, { archived: true, deleted: true }).find((t) => t.id === id)!;
	await post((await import('./library/+page.server')).actions, 'unarchive', { id });
	expect(row()).toMatchObject({ archived: false, deleteAfter: null });
	expect(await post((await import('./library/[id]/+page.server')).actions, 'delete', {}, { id })).toEqual({ deleted: { archived: false } });
	expect(row().archived).toBe(true);
	expect(row().deleteAfter).toBeInstanceOf(Date);
});
