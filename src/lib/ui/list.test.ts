import { describe, expect, it } from 'vitest';
import { applyMove, dropPosition, mergeOrder, moveBy, moveKey, rangeKeys, reorderFrom, selectionState } from './list';

const keys = ['a', 'b', 'c', 'd'];

describe('dropPosition', () => {
	const rect = { top: 100, height: 40 };
	it('splits a row in halves without nesting', () => {
		expect(dropPosition(105, rect, false)).toBe('before');
		expect(dropPosition(119, rect, false)).toBe('before');
		expect(dropPosition(121, rect, false)).toBe('after');
		expect(dropPosition(139, rect, false)).toBe('after');
	});
	it('keeps the middle half for "inside" with nesting', () => {
		expect(dropPosition(105, rect, true)).toBe('before');
		expect(dropPosition(120, rect, true)).toBe('inside');
		expect(dropPosition(135, rect, true)).toBe('after');
	});
	it('treats points past the edges as the nearest edge', () => {
		expect(dropPosition(50, rect, true)).toBe('before');
		expect(dropPosition(500, rect, true)).toBe('after');
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
