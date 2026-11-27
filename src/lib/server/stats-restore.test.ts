// A habit's Stats tab: "Back to the automatic cards" and the Undo that puts its own cards back. And boards put in order
// (a tab dragged, or Move…), whose Undo is the order before.
import { beforeAll, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { userToday } from './today';
import { saveHabit } from './repo/habits';
import { getStats } from './stats';
import { changeStats } from './stats-change';
import { habitForm } from '$lib/forms';
import { makeCard } from '$lib/stats/model';

let me: string;
let run: string;

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('statsrestore', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	const today = userToday(me);
	const v = randomUUID();
	run = saveHabit(me, null, habitForm.parse({ name: 'Run', direction: 'build', startDate: today, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'interval', every: 1, start: today, variantId: v } }), today)!;
});

const mine = (title: string) => makeCard({ title, what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', range: '30d', look: { chart: 'tile' } });
/** Make the tab the habit's own, with a Today number from one of its cards; give back the cards and that number. */
function customize() {
	changeStats(me, { op: 'card.save', where: { habit: run }, card: mine('Mine') });
	const card = getStats(me).habitCards[run].find((c) => c.title === 'Mine')!;
	changeStats(me, { op: 'headline', habit: run, card });
	const s = getStats(me);
	return { cards: s.habitCards[run], headline: s.headlines[run] };
}

it('puts back the cards and the Today number that the reset took away, as they were', () => {
	const was = customize();
	changeStats(me, { op: 'habit.reset', habit: run });
	expect(getStats(me).habitCards[run]).toBeUndefined();
	expect(getStats(me).headlines[run]).toBeUndefined();

	changeStats(me, { op: 'habit.restore', habit: run, ...was });
	expect(getStats(me).habitCards[run]).toEqual(was.cards);
	expect(getStats(me).headlines[run]).toEqual(was.headline);
});

it('keeps a Today number picked since the reset, and restores without one', () => {
	const was = customize();
	changeStats(me, { op: 'habit.reset', habit: run });
	changeStats(me, { op: 'headline', habit: run, card: mine('Picked since') });
	changeStats(me, { op: 'habit.restore', habit: run, ...was });
	expect(getStats(me).habitCards[run]).toEqual(was.cards);
	expect(getStats(me).headlines[run].title).toBe('Picked since');

	changeStats(me, { op: 'headline', habit: run, card: null });
	changeStats(me, { op: 'habit.reset', habit: run });
	changeStats(me, { op: 'habit.restore', habit: run, cards: was.cards });
	expect(getStats(me).habitCards[run]).toEqual(was.cards);
	expect(getStats(me).headlines[run]).toBeUndefined();
});

it('refuses a habit that is not there', () => {
	expect(() => changeStats(me, { op: 'habit.restore', habit: 'nope', cards: [] })).toThrow(/No such habit/);
});

it('refuses to undo the reset once the tab has its own cards again, and changes nothing', () => {
	const was = customize();
	changeStats(me, { op: 'habit.reset', habit: run });
	changeStats(me, { op: 'card.save', where: { habit: run }, card: mine('Made since') });
	const since = getStats(me).habitCards[run];
	expect(() => changeStats(me, { op: 'habit.restore', habit: run, ...was })).toThrow(/changed since/);
	expect(getStats(me).habitCards[run]).toEqual(since);
});

it('puts the boards in the order given, the rest after them, and back again', () => {
	for (const name of ['A', 'B', 'C']) changeStats(me, { op: 'board.add', name });
	const ids = () => getStats(me).boards.map((b) => b.id);
	const was = ids();
	const [a, b, c] = ['A', 'B', 'C'].map((n) => getStats(me).boards.find((x) => x.name === n)!.id);
	changeStats(me, { op: 'board.order', ids: [c, a] });
	expect(ids().slice(0, 2)).toEqual([c, a]);
	expect(ids().slice(2)).toEqual(was.filter((x) => x !== c && x !== a));
	expect(ids()).toContain(b);
	changeStats(me, { op: 'board.order', ids: was });
	expect(ids()).toEqual(was);
});
