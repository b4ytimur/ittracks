// A Stats band Undo puts back what its own change did, and nothing it didn't: a filter word, the board Stats opens
// with, and a habit's automatic cards.
import { beforeAll, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { userToday } from './today';
import { saveHabit } from './repo/habits';
import { getStats, statsContext } from './stats';
import { changeStats } from './stats-change';
import { habitForm } from '$lib/forms';
import { habitCards } from '$lib/stats/auto';

let me: string;
let run: string;

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('statsundo', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	const today = userToday(me);
	const v = randomUUID();
	run = saveHabit(me, null, habitForm.parse({ name: 'Run', direction: 'build', startDate: today, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'interval', every: 1, start: today, variantId: v } }), today)!;
});

const auto = () => {
	const { P } = statsContext(me, 'UTC');
	return habitCards(P, P.habits.get(run)!);
};

it("undoing a habit tab's first card change leaves it on the automatic cards, not a frozen copy of them", () => {
	const [first, second] = auto();
	expect(getStats(me).habitCards[run]).toBeUndefined();

	changeStats(me, { op: 'card.save', where: { habit: run }, card: { ...first, look: { ...first.look, size: 'full' } } });
	expect(getStats(me).habitCards[run]).toBeDefined();
	changeStats(me, { op: 'card.save', where: { habit: run }, card: first });
	expect(getStats(me).habitCards[run]).toBeUndefined();

	changeStats(me, { op: 'card.delete', where: { habit: run }, id: second.id });
	changeStats(me, { op: 'card.save', where: { habit: run }, card: second, index: 1 });
	expect(getStats(me).habitCards[run]).toBeUndefined();

	const ids = auto().map((c) => c.id);
	changeStats(me, { op: 'card.order', where: { habit: run }, ids: [...ids].reverse() });
	changeStats(me, { op: 'card.order', where: { habit: run }, ids });
	expect(getStats(me).habitCards[run]).toBeUndefined();
});

it('an Undo out of turn keeps the newer change, so the cards stay your own', () => {
	const [first, second] = auto();
	changeStats(me, { op: 'card.save', where: { habit: run }, card: { ...first, look: { ...first.look, size: 'full' } } });
	changeStats(me, { op: 'card.delete', where: { habit: run }, id: second.id });
	changeStats(me, { op: 'card.save', where: { habit: run }, card: first });
	const cards = getStats(me).habitCards[run];
	expect(cards.map((c) => c.id)).not.toContain(second.id);
	expect(cards.find((c) => c.id === first.id)?.look.size).toBe(first.look.size);
	changeStats(me, { op: 'habit.reset', habit: run });
});

it("a filter change's Undo puts back only its own word, so a word changed since stays", () => {
	const id = changeStats(me, { op: 'board.add', name: 'Filters' }).id!;
	changeStats(me, { op: 'board.patch', id, filter: { direction: 'build' } });
	changeStats(me, { op: 'board.patch', id, filter: { habit: run } });
	// The Undo of the first change, as the Stats page sends it.
	changeStats(me, { op: 'board.patch', id, filter: { direction: 'all' } });
	expect(getStats(me).boards.find((b) => b.id === id)!.filter).toMatchObject({ direction: 'all', habit: run, areas: [], tags: [] });
	changeStats(me, { op: 'board.delete', id });
});

it("an Area or Tag toggle's Undo turns back only that one, so one toggled since stays", () => {
	const id = changeStats(me, { op: 'board.add', name: 'Toggles' }).id!;
	const filter = () => getStats(me).boards.find((b) => b.id === id)!.filter;
	changeStats(me, { op: 'board.patch', id, toggle: { list: 'tags', value: 'A', on: true } });
	changeStats(me, { op: 'board.patch', id, toggle: { list: 'tags', value: 'B', on: true } });
	// The Undo of A, as the Stats page sends it.
	changeStats(me, { op: 'board.patch', id, toggle: { list: 'tags', value: 'A', on: false } });
	expect(filter().tags).toEqual(['B']);
	// Off twice, or on when it is on, changes nothing.
	changeStats(me, { op: 'board.patch', id, toggle: { list: 'tags', value: 'A', on: false } });
	changeStats(me, { op: 'board.patch', id, toggle: { list: 'tags', value: 'B', on: true } });
	expect(filter().tags).toEqual(['B']);
	changeStats(me, { op: 'board.patch', id, toggle: { list: 'areas', value: 'a1', on: true } });
	expect(filter()).toMatchObject({ areas: ['a1'], tags: ['B'] });
	changeStats(me, { op: 'board.delete', id });
});

it('undoing Delete board brings back "Stats opens with this board" when it did, and only then', () => {
	const id = changeStats(me, { op: 'board.add', name: 'Opens' }).id!;
	changeStats(me, { op: 'open', value: id });
	const s = getStats(me);
	const index = s.boards.findIndex((b) => b.id === id);
	const copy = s.boards[index];

	changeStats(me, { op: 'board.delete', id });
	expect(getStats(me).open).toBe('last');
	changeStats(me, { op: 'board.restore', board: copy, index, open: true });
	expect(getStats(me).open).toBe(id);
	expect(getStats(me).boards.findIndex((b) => b.id === id)).toBe(index);

	changeStats(me, { op: 'open', value: 'last' });
	changeStats(me, { op: 'board.delete', id });
	changeStats(me, { op: 'board.restore', board: copy, index });
	expect(getStats(me).open).toBe('last');
	changeStats(me, { op: 'board.delete', id });

	// Another board picked to open with after the delete: the Undo keeps that one.
	const other = changeStats(me, { op: 'board.add', name: 'Other' }).id!;
	changeStats(me, { op: 'board.restore', board: copy, index });
	changeStats(me, { op: 'open', value: id });
	changeStats(me, { op: 'board.delete', id });
	changeStats(me, { op: 'open', value: other });
	changeStats(me, { op: 'board.restore', board: copy, index, open: true });
	expect(getStats(me).open).toBe(other);
	changeStats(me, { op: 'board.delete', id });
	changeStats(me, { op: 'board.delete', id: other });
});
