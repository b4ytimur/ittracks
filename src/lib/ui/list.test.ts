import { describe, expect, it } from 'vitest';
import { applyMove, dropDepth, dropPosition, gridDrop, mergeOrder, moveBy, moveChoices, moveKey, nearest, pressMoved, rangeKeys, reorderFrom, selectionState, withDescendants, type Move } from './list';

const keys = ['a', 'b', 'c', 'd'];

describe('dropPosition', () => {
	const rect = { top: 100, height: 40 };
	it('splits a row in halves', () => {
		expect([105, 119, 121, 139].map((y) => dropPosition(y, rect))).toEqual(['before', 'before', 'after', 'after']);
	});
	it('treats points past the edges as the nearest edge', () => {
		expect([dropPosition(50, rect), dropPosition(500, rect)]).toEqual(['before', 'after']);
	});
});

describe('dropDepth', () => {
	it('snaps sideways travel to the nearest step', () => {
		expect([0, 7, 9, 16, 40].map((dx) => dropDepth(dx, 16, -1, 1))).toEqual([0, 0, 1, 1, 1]);
		expect([-7, -9, -16, -90].map((dx) => dropDepth(dx, 16, -1, 1))).toEqual([0, -1, -1, -1]);
		// A finger needs more.
		expect([15, 17].map((dx) => dropDepth(dx, 32, 0, 1))).toEqual([0, 1]);
	});
	it('keeps to what the gap offers', () => {
		expect([dropDepth(60, 16, 0, 0), dropDepth(-60, 16, 0, 1)]).toEqual([0, 0]);
	});
	it('mirrors in right-to-left text', () => {
		expect([dropDepth(-20, 16, -1, 1, true), dropDepth(20, 16, -1, 1, true)]).toEqual([1, -1]);
	});
});

describe('moveKey', () => {
	it('puts a key before or after another', () => {
		expect(moveKey(keys, 'd', 'a', 'before')).toEqual(['d', 'a', 'b', 'c']);
		expect(moveKey(keys, 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
		expect(moveKey(keys, 'a', 'd', 'after')).toEqual(['b', 'c', 'd', 'a']);
		expect(moveKey(keys, 'c', 'b', 'before')).toEqual(['a', 'c', 'b', 'd']);
	});
	it('changes nothing for itself or unknown keys', () => {
		expect(moveKey(keys, 'a', 'a', 'after')).toBe(keys);
		expect(moveKey(keys, 'x', 'a', 'after')).toBe(keys);
		expect(moveKey(keys, 'a', 'x', 'after')).toBe(keys);
	});
	it('a drop next to where it already is keeps the order', () => {
		expect(moveKey(keys, 'b', 'a', 'after')).toEqual(keys);
		expect(moveKey(keys, 'b', 'c', 'before')).toEqual(keys);
	});
});

describe('moveBy', () => {
	it('moves up and down by places', () => {
		expect(moveBy(keys, 'c', -1)).toEqual(['a', 'c', 'b', 'd']);
		expect(moveBy(keys, 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
	});
	it('stays in bounds', () => {
		expect(moveBy(keys, 'a', -1)).toBe(keys);
		expect(moveBy(keys, 'd', 1)).toBe(keys);
		expect(moveBy(keys, 'b', -9)).toEqual(['b', 'a', 'c', 'd']);
	});
});

describe('applyMove', () => {
	it('reorders on before and after, and takes the key out on inside', () => {
		expect(applyMove(keys, { key: 'a', target: 'c', position: 'after' })).toEqual(['b', 'c', 'a', 'd']);
		expect(applyMove(keys, { key: 'a', target: 'c', position: 'inside' })).toEqual(['b', 'c', 'd']);
	});
});

describe('mergeOrder', () => {
	it('puts a reordered part back into the places it held', () => {
		// One Area group (b, d) reordered: the others keep their places.
		expect(mergeOrder(['a', 'b', 'c', 'd', 'e'], ['d', 'b'])).toEqual(['a', 'd', 'c', 'b', 'e']);
	});
	it('adds keys the full order does not have at the end', () => {
		expect(mergeOrder(['a', 'b'], ['x', 'b'])).toEqual(['a', 'x', 'b']);
		expect(mergeOrder([], ['b', 'a'])).toEqual(['b', 'a']);
	});
	it('a part in the same order changes nothing', () => {
		expect(mergeOrder(['a', 'b', 'c'], ['a', 'c'])).toEqual(['a', 'b', 'c']);
	});
});

describe('rangeKeys', () => {
	it('gives the keys between two, either way round', () => {
		expect(rangeKeys(keys, 'b', 'd')).toEqual(['b', 'c', 'd']);
		expect(rangeKeys(keys, 'd', 'b')).toEqual(['b', 'c', 'd']);
		expect(rangeKeys(keys, 'c', 'c')).toEqual(['c']);
	});
	it('falls back to the clicked key when the anchor is gone', () => {
		expect(rangeKeys(keys, 'x', 'c')).toEqual(['c']);
		expect(rangeKeys(keys, 'a', 'x')).toEqual([]);
	});
});

describe('selectionState', () => {
	it('says none, some or all', () => {
		expect(selectionState(keys, new Set())).toBe('none');
		expect(selectionState(keys, new Set(['a', 'x']))).toBe('some');
		expect(selectionState(keys, new Set(keys))).toBe('all');
	});
});

describe('reorderFrom', () => {
	const order = ['a', 'b', 'c', 'd'];
	it('changes the shared order in place when the page is sorted by it', () => {
		expect(reorderFrom(order, ['a', 'c'], ['c', 'a'], true)).toEqual(['c', 'b', 'a', 'd']);
	});
	it('starts from what is shown when the page is sorted another way', () => {
		// Shown by name: d, c, b. The user drags b to the top.
		expect(reorderFrom(order, ['d', 'c', 'b'], ['b', 'd', 'c'], false)).toEqual(['b', 'd', 'c', 'a']);
	});
});

describe('gridDrop', () => {
	// Two half-width cards on the first line, one full-width card under them.
	const cells = [
		{ key: 'a', box: { left: 0, top: 0, width: 190, height: 100 } },
		{ key: 'b', box: { left: 210, top: 0, width: 190, height: 100 } },
		{ key: 'c', box: { left: 0, top: 120, width: 400, height: 100 } }
	];
	it('splits a narrow cell left and right', () => {
		expect(gridDrop(20, 50, cells, 400)).toEqual({ key: 'a', position: 'before' });
		expect(gridDrop(180, 50, cells, 400)).toEqual({ key: 'a', position: 'after' });
		expect(gridDrop(220, 10, cells, 400)).toEqual({ key: 'b', position: 'before' });
	});
	it('splits a full-width cell top and bottom', () => {
		expect(gridDrop(390, 130, cells, 400)).toEqual({ key: 'c', position: 'before' });
		expect(gridDrop(10, 210, cells, 400)).toEqual({ key: 'c', position: 'after' });
	});
	it('takes the nearest cell from a gap or past the end', () => {
		expect(gridDrop(200, 50, cells, 400)?.key).toMatch(/a|b/);
		expect(gridDrop(200, 500, cells, 400)).toEqual({ key: 'c', position: 'after' });
		expect(gridDrop(0, 0, [], 400)).toBeNull();
	});
});

describe('withDescendants', () => {
	it('gives a holder with everything inside it, depth first', () => {
		const inside: Record<string, string[]> = { week: ['gym', 'evening'], evening: ['read'] };
		expect(withDescendants('week', (k) => inside[k] ?? [])).toEqual(['week', 'gym', 'evening', 'read']);
		expect(withDescendants('gym', (k) => inside[k] ?? [])).toEqual(['gym']);
	});
});

describe('moveChoices', () => {
	const names: Record<string, string> = { a: 'Gym', b: 'Read', c: 'Walk', d: 'Stretch' };
	const nameOf = (k: string) => names[k];
	const flat = (m: Move) => m.position !== 'inside'; // the list's rule without canDrop
	const nests = () => true;
	const labels = (key: string, o: Partial<Parameters<typeof moveChoices>[2]> = {}) => moveChoices(keys, key, { allowed: flat, nameOf, ...o }).map((c) => c.label);

	it('in a flat list: up and down, none past either end, never inside', () => {
		expect(labels('a')).toEqual(['Move down']);
		expect(labels('b')).toEqual(['Move up', 'Move down']);
		expect(labels('d')).toEqual(['Move up']);
		expect(moveChoices(['a'], 'a', { allowed: flat, nameOf })).toEqual([]);
	});
	it('each choice is the move the arrow keys make', () => {
		expect(moveChoices(keys, 'c', { allowed: nests, nameOf }).map((c) => c.move)).toEqual([
			{ key: 'c', target: 'b', position: 'before' },
			{ key: 'c', target: 'd', position: 'after' },
			{ key: 'c', target: 'b', position: 'inside' }
		]);
	});
	it('where rows nest: inside the row above, named, and not for the first row', () => {
		expect(labels('a', { allowed: nests })).toEqual(['Move down']);
		expect(labels('c', { allowed: nests })).toEqual(['Move up', 'Move down', 'Put inside Read']);
		expect(labels('d', { allowed: nests })).toEqual(['Move up', 'Put inside Walk']);
	});
	it('leaves out what the list refuses', () => {
		// Only Read holds others; nothing goes after d (a group with no Area, say).
		const allowed = (m: Move) => (m.position === 'inside' ? m.target === 'b' : !(m.target === 'd' && m.position === 'after'));
		expect(labels('c', { allowed })).toEqual(['Move up', 'Put inside Read']);
		expect(labels('b', { allowed })).toEqual(['Move up', 'Move down']);
	});
	it("in a holder's list: Take out of the holder, after the moves, for every row", () => {
		const kids = ['b', 'c'];
		const of = (key: string) => moveChoices(kids, key, { allowed: flat, nameOf, outOf: 'Gym' }).map((c) => c.label);
		expect(of('b')).toEqual(['Move down', 'Take out of Gym']);
		expect(of('c')).toEqual(['Move up', 'Take out of Gym']);
		expect(moveChoices(['b'], 'b', { allowed: flat, nameOf, outOf: 'Gym' })).toEqual([{ label: 'Take out of Gym', move: 'out' }]);
		expect(moveChoices(['b'], 'b', { allowed: flat, nameOf, outOf: '' }).map((c) => c.label)).toEqual(['Take out']);
	});
	it('in a grid: earlier and later, never inside', () => {
		expect(labels('b', { allowed: nests, grid: true })).toEqual(['Move earlier', 'Move later']);
	});
	it('offers nothing for a key the list does not have', () => {
		expect(moveChoices(keys, 'x', { allowed: nests, nameOf, outOf: 'Gym' })).toEqual([]);
	});
});

describe('pressMoved', () => {
	it('a mouse or pen lifts the row once it moves past 4px', () => {
		expect(pressMoved(0, 0, false)).toBe('stay');
		expect(pressMoved(3, -2, false)).toBe('stay');
		expect(pressMoved(0, 5, false)).toBe('lift');
	});
	it('a finger gets 10px, and moving past them first is a swipe that scrolls, never a lift', () => {
		expect(pressMoved(6, 6, true)).toBe('stay');
		expect(pressMoved(0, 11, true)).toBe('scroll');
		expect(pressMoved(-11, 0, true)).toBe('scroll');
	});
});

describe('nearest', () => {
	it('keeps the place, or takes the last one when the place is gone', () => {
		expect(nearest(1, 3)).toBe(1);
		expect(nearest(3, 3)).toBe(2);
		expect(nearest(-1, 3)).toBe(0); // a control that was in an open menu: the row's first
	});
	it('has nowhere to go when nothing is left', () => {
		expect(nearest(0, 0)).toBe(-1);
	});
});
