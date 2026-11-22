import { describe, expect, it } from 'vitest';
import { isTick, slotGroups } from './groups';

const e = (taskId: string, values: Record<string, unknown>) => ({ taskId, values });

describe('slotGroups', () => {
	it('splits one Task used in two Slots at each once-per-log value', () => {
		const entries = [
			e('read', { pages: 10 }),
			e('read', { _summary: true, book: 'Dune' }),
			e('walk', { _summary: true, mins: 20 }),
			e('read', { pages: 5 }),
			e('read', { _summary: true, book: 'Emma' })
		];
		const g = slotGroups(entries, 'read');
		expect(g).toHaveLength(2);
		expect(g[1].map((x) => x.values)).toEqual([{ pages: 5 }, { _summary: true, book: 'Emma' }]);
	});

	it('a sets-only Slot is closed by an empty marker, and a Yes or no tick closes its own group', () => {
		const sets = [e('lift', { kg: 50 }), e('lift', { kg: 55 }), e('lift', { _summary: true }), e('lift', { kg: 40 })];
		expect(slotGroups(sets, 'lift').map((x) => x.length)).toEqual([3, 1]);
		const ticks = [e('dishes', { done: true }), e('dishes', { done: true })];
		expect(slotGroups(ticks, 'dishes')).toHaveLength(2);
		expect(isTick({ done: true })).toBe(true);
		expect(isTick({ done: true, note: 'x' })).toBe(false);
	});
});
