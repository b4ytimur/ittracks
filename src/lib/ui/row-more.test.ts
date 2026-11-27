// Archived from its ⋯, a row that was its list's last hands the focus to the next row's ⋯ on the page, else the one before.
import { describe, expect, it } from 'vitest';
import { nextHere } from './row-more';

describe('nextHere', () => {
	const here = (gone: string[]) => (x: string) => !gone.includes(x);
	it('the first one after that is still here', () => {
		expect(nextHere(['a', 'b', 'c', 'd'], 1, here(['b', 'c']))).toBe('d');
	});
	it('none after: the nearest before', () => {
		expect(nextHere(['a', 'b', 'c', 'd'], 3, here(['c', 'd']))).toBe('b');
	});
	it('nothing left, or nowhere it was: nothing after or before', () => {
		expect(nextHere(['a'], 0, here(['a']))).toBeUndefined();
		expect(nextHere(['a', 'b'], -1, here([]))).toBe('a');
	});
});
