import { describe, expect, it } from 'vitest';
import { canUndo, dropEntry, pushEntry, setHeld, type Entry } from './echo';

const e = (id: number, o: Partial<Entry> = {}): Entry => ({ id, text: `change ${id}`, ...o });

describe('the band', () => {
	it('keeps the last ten, newest first', () => {
		const all = Array.from({ length: 12 }, (_, i) => e(i)).reduce(pushEntry, [] as Entry[]);
		expect(all.map((x) => x.id)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
	});
	it('offers no Undo while the row shows its own', () => {
		const one = [e(1, { undo: () => {} })];
		expect(canUndo(one[0])).toBe(true);
		expect(canUndo(setHeld(one, 1, true)[0])).toBe(false);
		expect(canUndo(setHeld(setHeld(one, 1, true), 1, false)[0])).toBe(true);
	});
	it('drops one and leaves the rest', () => {
		expect(dropEntry([e(2), e(1)], 2).map((x) => x.id)).toEqual([1]);
	});
});
