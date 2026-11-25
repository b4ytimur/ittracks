import { beforeAll, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { collection, settings, slot, tag } from '../db/schema';
import { createAccount } from '../auth';
import { getSettings, saveSettings } from '../settings';
import { habitForm, taskForm } from '$lib/forms';
import { saveHabit } from './habits';
import { saveTask } from './tasks';
import { renameTag } from './tags';

let me: string;
let other: string;
const all = () => ({
	tags: db.select().from(tag).all(),
	slots: db.select({ rule: slot.fillRule }).from(slot).all(),
	collections: db.select({ filter: collection.filter }).from(collection).all(),
	settings: db.select().from(settings).all()
});
const idOf = (who: string, name: string) => db.select().from(tag).where(eq(tag.accountId, who)).all().find((t) => t.name === name)!.id;

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('tags', 'correct horse battery');
	other = await createAccount('tags-other', 'correct horse battery');
	for (const who of [me, other]) {
		saveTask(who, null, taskForm.parse({ name: 'Press', restTimerEnabled: false, restTimerSeconds: 90, tags: [{ name: 'chest', level: 3 }, { name: 'arms', level: 1 }], metrics: [], parts: [] }));
		const v = crypto.randomUUID();
		const rule = { must: { chest: 2 }, mustNot: { arms: 0 }, prefer: ['arms', 'chest'] };
		saveHabit(who, null, habitForm.parse({ name: 'Gym', direction: 'build', startDate: '2026-11-01', schedule: { kind: 'interval', every: 1, start: '2026-11-01', variantId: v }, variants: [{ id: v, name: 'Main', slots: [{ id: crypto.randomUUID(), taskId: null, fillRule: rule, sets: 3, targets: {}, minTargets: {}, stretchTargets: {} }] }] }), '2026-11-22');
		db.insert(collection).values({ id: crypto.randomUUID(), accountId: who, name: 'Push', filter: { tags: ['Chest'], areaId: null, text: '' } as never }).run();
		saveSettings(who, { views: { ...getSettings(who).views, last: { library: { tags: ['chest', 'arms'] } } } as never });
	}
});

it('goes with it everywhere, and back exactly', () => {
	const before = all();
	expect(renameTag(me, idOf(me, 'chest'), ' Pecs ')).toEqual({ was: 'chest', name: 'Pecs' });
	const now = all();
	expect(now.slots[0].rule).toEqual({ must: { Pecs: 2 }, mustNot: { arms: 0 }, prefer: ['arms', 'Pecs'] });
	expect(now.collections[0].filter!.tags).toEqual(['Pecs']);
	expect(JSON.stringify(now.settings.find((s) => s.accountId === me))).toContain('["Pecs","arms"]');
	// Another account's are its own.
	expect([now.slots[1], now.collections[1], now.settings.find((s) => s.accountId === other)]).toEqual([before.slots[1], before.collections[1], before.settings.find((s) => s.accountId === other)]);
	renameTag(me, idOf(me, 'Pecs'), 'chest');
	const back = all();
	expect([back.tags, back.slots]).toEqual([before.tags, before.slots]);
});

it('is refused when the way back would not be exact', () => {
	const before = all();
	expect(renameTag(me, idOf(me, 'chest'), 'Arms')).toHaveProperty('error');
	expect(renameTag(me, idOf(me, 'chest'), '  ')).toHaveProperty('error');
	expect(renameTag(other, idOf(me, 'chest'), 'Mine')).toHaveProperty('error');
	// Named by a filter though no tag has it.
	db.insert(collection).values({ id: crypto.randomUUID(), accountId: me, name: 'Old', filter: { tags: ['Legs'], areaId: null, text: '' } as never }).run();
	expect(renameTag(me, idOf(me, 'chest'), 'legs')).toHaveProperty('error');
	expect(all().tags).toEqual(before.tags);
});
