// A habit's Stats tab without Edit: its title line, its grips, the number Today shows, and the Undo that says why it failed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { cardAdded, headlineChange, tabMore } from './habit-tab';
import { undoOp } from './client';
import { makeCard } from './model';
import Page from '../../routes/(app)/habits/[id]/stats/+page.svelte';

const gym = { id: 'h1', name: 'Gym' };
const done = makeCard({ id: 'c1', title: 'Done' });
const week = makeCard({ id: 'c2', title: 'This week' });

describe('headlineChange: a tile on Today and its Undo', () => {
	it('shows a tile when Today shows the usual headline; Undo goes back to it', () => {
		expect(headlineChange(gym, null, done, 'Done')).toEqual({
			change: { op: 'headline', habit: 'h1', card: done },
			said: 'Today shows “Done” for Gym',
			undo: { op: 'headline', habit: 'h1', card: null }
		});
	});
	it('takes the place of another tile; Undo puts that one back', () => {
		const h = headlineChange(gym, week, done, 'Done');
		expect(h.change.card).toBe(done);
		expect(h.undo.card).toBe(week);
	});
	it('the tile Today shows stops showing; Undo shows it again', () => {
		expect(headlineChange(gym, done, done, 'Done')).toEqual({
			change: { op: 'headline', habit: 'h1', card: null },
			said: 'Today shows the usual headline again',
			undo: { op: 'headline', habit: 'h1', card: done }
		});
	});
});

describe('tabMore: the title line ⋯', () => {
	it('has Back to the automatic cards only while the tab has its own cards', () => {
		const reset = () => {};
		expect(tabMore(true, reset)).toEqual([{ label: 'Back to the automatic cards', onselect: reset }]);
		expect(tabMore(false, reset)).toEqual([]);
	});
});

describe('cardAdded: the line New card posts', () => {
	it('says what was added; its Undo takes that card off where it was added', () => {
		expect(cardAdded({ habit: 'h1' }, 'c9', 'Minutes')).toEqual({ said: 'Added “Minutes”', undo: { op: 'card.delete', where: { habit: 'h1' }, id: 'c9' } });
		expect(cardAdded({ board: 'b1' }, 'c9', 'Minutes', []).undo.where).toEqual({ board: 'b1' });
	});
	it("says the server's warning instead, with the same Undo", () => {
		expect(cardAdded({ board: 'b1' }, 'c9', 'Minutes', ['Cost is switched off']).said).toBe('Cost is switched off');
	});
});

describe('undoOp: a band Undo', () => {
	afterEach(() => vi.unstubAllGlobals());
	it('is true when the change went through', async () => {
		vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: true })));
		expect(await undoOp({ op: 'habit.restore' })()).toBe(true);
	});
	it('is what the server said when it was refused, for the band to show', async () => {
		vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ message: 'Its cards changed since. Nothing was undone.' }), { status: 409 }));
		expect(await undoOp({ op: 'habit.restore' })()).toBe('Its cards changed since. Nothing was undone.');
	});
});

describe('the tab', () => {
	const catalog = { habits: [{ ...gym, direction: 'build', archived: false, areaId: null, hasCost: false, logged: 3 }], tasks: [], metrics: [], tags: [], groupings: [], areas: [], identities: [] };
	const data = (customized: boolean) => ({
		habit: { ...gym, direction: 'build' },
		customized,
		items: [done, week].map((card) => ({ card, result: null, warnings: [], rangeKey: '30d' })),
		headline: null,
		catalog,
		measures: [],
		hidden: [],
		suggested: [],
		gallery: []
	});
	const html = (customized: boolean) => render(Page, { props: { data: data(customized) as never } }).body.replace(/<!--.*?-->/g, '');

	it('has no Edit: the title line with ‹ Habits, the name and New card, and a grip on every card', () => {
		const b = html(false);
		expect(b).toContain('Back to Habits');
		expect(b).toMatch(/<h1 class="page-title">Gym<\/h1>/);
		expect(b).toMatch(/<button type="button" class="primary" data-add[^>]*>New card<\/button>/);
		expect(b).not.toMatch(/radiogroup|>Edit</);
		expect(b).toMatch(/<ul[^>]*class="[^"]*\bgrips\b/);
		expect(b.match(/aria-label="Move Done|aria-label="Move This week/g)?.length).toBe(2);
	});
	it('made from its logs: no ⋯, and the line under the cards names the words, the ⋯ and the grip', () => {
		const b = html(false);
		expect(b).not.toContain('More on Gym');
		expect(b).toContain('Made from what it logs');
		expect(b).toContain('Change one in its words or its ⋯, or move one by its ⠿');
	});
	it('with its own cards: the ⋯, and no line under the cards', () => {
		const b = html(true);
		expect(b).toContain('More on Gym');
		expect(b).toContain('Your own cards');
		expect(b).not.toContain('These cards are made from');
	});
});
