// A view's band Undo puts back only what its own change did, never a change made since.
import { beforeAll, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './db';
import { createAccount } from './auth';
import { getViews } from './settings';
import { changeViews } from './views';
import { viewState } from '$lib/views';
import { ownNumber } from '$lib/view-words';

let me: string;
beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('views-undelete', 'correct horse battery');
});

it('brings the view back where it stood, the page on it and opening with it, and keeps what changed since', () => {
	const state = viewState.parse({ sort: 'name' });
	changeViews(me, { op: 'save', page: 'habits', name: 'First', state });
	const mine = changeViews(me, { op: 'save', page: 'habits', name: 'Mine', state }).id!;
	changeViews(me, { op: 'save', page: 'habits', name: 'Last', state });
	changeViews(me, { op: 'open', page: 'habits', value: mine });
	const view = getViews(me).saved.find((s) => s.id === mine)!;

	changeViews(me, { op: 'delete', id: mine });
	// Made since the delete: the Undo leaves it be.
	changeViews(me, { op: 'patch', today: { order: ['gym'], headlineFor: { gym: 'streak' } } });
	changeViews(me, { op: 'undelete', view, index: 1, open: true });

	const v = getViews(me);
	expect(v.saved.map((s) => s.name)).toEqual(['First', 'Mine', 'Last']);
	expect(v.active.habits).toBe(mine);
	expect(v.open.habits).toBe(mine);
	expect(v.today.order).toEqual(['gym']);
	expect(v.today.headlineFor).toEqual({ gym: 'streak' });

	// Twice is once; and a page that opened with the last view keeps that.
	changeViews(me, { op: 'open', page: 'habits', value: 'last' });
	changeViews(me, { op: 'undelete', view, index: 0, open: false });
	expect(getViews(me).saved.filter((s) => s.id === mine)).toHaveLength(1);
	expect(getViews(me).open.habits).toBe('last');
});

it("undoing one habit's Number keeps the number picked for another since", () => {
	changeViews(me, { op: 'patch', today: { headlineFor: {} } });
	const pick = (id: string, v: Parameters<typeof ownNumber>[3]) => changeViews(me, { op: 'patch', today: { headlineFor: ownNumber(getViews(me).today.headlineFor, id, id, v).next } });
	pick('read', 'streak');
	pick('gym', 'total');
	// Today's Undo for Read: Read's number before, applied to the numbers as they are now.
	pick('read', '');
	expect(getViews(me).today.headlineFor).toEqual({ gym: 'total' });
});
