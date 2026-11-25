import { beforeAll, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { habit, task } from './db/schema';
import { createAccount } from './auth';
import { addTemplate, unadd, type AddResult } from './repo/templates';
import { getUnits } from './settings';
import { takePack } from './packs';
import { listGallery } from '$lib/gallery';

let me: string;
beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('unadd', 'correct horse battery');
});
const here = () => [db.select().from(habit).where(and(eq(habit.accountId, me), isNull(habit.deleteAfter))).all().length, db.select().from(task).where(and(eq(task.accountId, me), isNull(task.deleteAfter), isNull(task.parentTaskId))).all().length];
const add = (slug: string) => addTemplate(me, listGallery(getUnits(me)).find((g) => g.slug === slug)!.template, { today: '2026-11-25', reuse: true }) as AddResult;

it('every ready-made habit can be added as it comes and taken back whole', () => {
	for (const p of ['gym', 'running', 'music', 'reading', 'study']) takePack(me, p);
	for (const g of listGallery(getUnits(me))) {
		const before = here();
		const r = add(g.slug);
		expect(here()[0]).toBeGreaterThan(before[0]);
		expect(unadd(me, r.made, '2026-11-25')).toBe(true);
		expect(here()).toEqual(before);
	}
});
it('a Task another habit uses stays', () => {
	const one = add('push-pull-legs');
	const [, tasks] = here();
	const two = add('upper-lower-4');
	expect(two.reused).toBeGreaterThan(0);
	unadd(me, one.made, '2026-11-25');
	expect(here()[0]).toBe(1);
	expect(here()[1]).toBeGreaterThanOrEqual(two.reused);
	expect(here()[1]).toBeLessThan(tasks + two.created);
});
