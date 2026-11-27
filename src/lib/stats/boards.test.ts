import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { boardPlaces, boardSaid, filtersOn, keyMoved, movedSaid } from './boards';
import BoardTabs from './ui/BoardTabs.svelte';

const boards = [
	{ id: 'o', name: 'Overview' },
	{ id: 't', name: 'Training' },
	{ id: 'g', name: 'Gym' }
];

describe('boardPlaces: where Move… can put a board', () => {
	it('offers First and After each other board, never the place it has', () => {
		expect(boardPlaces(boards, 't')).toEqual([
			{ label: 'First', order: ['t', 'o', 'g'] },
			{ label: 'After Gym', order: ['o', 'g', 't'] }
		]);
	});
	it('the first board has no First; the last can go after every board but the one before it', () => {
		expect(boardPlaces(boards, 'o').map((p) => p.label)).toEqual(['After Training', 'After Gym']);
		expect(boardPlaces(boards, 'g')).toEqual([
			{ label: 'First', order: ['g', 'o', 't'] },
			{ label: 'After Overview', order: ['o', 'g', 't'] }
		]);
	});
	it('offers nothing for a lone board or one that is not there', () => {
		expect(boardPlaces([boards[0]], 'o')).toEqual([]);
		expect(boardPlaces(boards, 'x')).toEqual([]);
	});
});

describe('movedSaid: the band line after a move', () => {
	it('names the board before it, or says first', () => {
		expect(movedSaid(boards, ['o', 'g', 't'], 't')).toBe('Moved “Training” after “Gym”.');
		expect(movedSaid(boards, ['t', 'o', 'g'], 't')).toBe('Moved “Training” first.');
	});
});

describe('keyMoved: Alt with an arrow on a focused tab', () => {
	const ids = boards.map((b) => b.id);
	const alt = (key: string, altKey = true) => ({ key, altKey });
	it('moves one place the way the tabs read', () => {
		expect(keyMoved(ids, 't', alt('ArrowLeft'), false)).toEqual(['t', 'o', 'g']);
		expect(keyMoved(ids, 't', alt('ArrowRight'), false)).toEqual(['o', 'g', 't']);
	});
	it('flips for right-to-left tabs', () => {
		expect(keyMoved(ids, 't', alt('ArrowLeft'), true)).toEqual(['o', 'g', 't']);
		expect(keyMoved(ids, 't', alt('ArrowRight'), true)).toEqual(['t', 'o', 'g']);
	});
	it('keeps the order at an edge, so the key is still taken from the browser', () => {
		expect(keyMoved(ids, 'o', alt('ArrowLeft'), false)).toEqual(ids);
		expect(keyMoved(ids, 'g', alt('ArrowRight'), false)).toEqual(ids);
	});
	it('leaves every other key alone', () => {
		expect(keyMoved(ids, 't', alt('ArrowLeft', false), false)).toBeNull();
		expect(keyMoved(ids, 't', alt('ArrowUp'), false)).toBeNull();
		expect(keyMoved(ids, 't', alt('Enter'), false)).toBeNull();
	});
});

describe('BoardTabs', () => {
	const html = (props: Record<string, unknown>) => render(BoardTabs, { props: { boards, current: 't', ondelete: () => {}, ...props } }).body;
	const labels = (out: string) => [...out.matchAll(/class="menu-label">([^<]*)</g)].map((m) => m[1]);

	it('draws each board as a link, the current one marked, none natively draggable', () => {
		const out = html({});
		expect(out.match(/<a class="tab[^"]*"/g)).toHaveLength(3);
		expect(out).toMatch(/<a class="tab[^"]*"[^>]*href="\?board=t"[^>]*aria-current="page"/);
		expect(out.match(/draggable="false"/g)).toHaveLength(3);
	});
	it("puts this board's Rename, Move… and Delete between the page's own items", () => {
		const out = html({ before: [{ label: 'New board…' }], after: [{ label: 'Stats opens with this board', checked: true }] });
		expect(labels(out)).toEqual(['New board…', 'Rename this board', 'Move…', 'Delete board', 'Stats opens with this board']);
	});
	it('offers no Move… for a lone board, and only the page items with no board', () => {
		expect(labels(html({ boards: [boards[1]] }))).toEqual(['Rename this board', 'Delete board']);
		expect(labels(html({ boards: [], current: null, before: [{ label: 'New board…' }], after: [{ label: 'x' }] }))).toEqual(['New board…']);
	});
});

describe('boardSaid: the band line after a range pill or Filter', () => {
	const none = { areas: [], tags: [], habit: null, identity: null, direction: 'all' as const };
	it('names the range it shows now', () => {
		expect(boardSaid('Overview', { range: '30d' })).toBe('Changed the range of “Overview” to last 30 days.');
		expect(boardSaid('Overview', { range: 'all' })).toBe('Changed the range of “Overview” to all time.');
	});
	it('says the filter changed while one is on, and cleared when none is', () => {
		expect(boardSaid('Gym', { filter: { ...none, areas: ['a'] } })).toBe('Changed the filter of “Gym”.');
		expect(boardSaid('Gym', { filter: { ...none, direction: 'break' } })).toBe('Changed the filter of “Gym”.');
		expect(boardSaid('Gym', { filter: none })).toBe('Cleared the filter of “Gym”.');
	});
	it('counts each filter that is on, as Filter (n) shows', () => {
		expect(filtersOn(none)).toBe(0);
		expect(filtersOn({ areas: ['a', 'b'], tags: ['t'], habit: 'h', identity: 'i', direction: 'build' })).toBe(6);
	});
});
