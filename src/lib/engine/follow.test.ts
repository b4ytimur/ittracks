import { describe, expect, it } from 'vitest';
import { dueOn, rollupRuleOf, type Follow } from './schedule';
import { standaloneSchedule } from './follow';

const f = (on: string[] | null = null): Follow => ({ kind: 'follow', variantId: 'mine', on });

describe('a habit that follows its routine', () => {
	it('is due when the routine is, with its own Variant', () => {
		const parent = (d: string) => (d === '2026-11-23' ? 'A' : d === '2026-11-24' ? 'B' : null);
		expect(dueOn(f(), [], '2026-11-23', parent)).toBe('mine');
		expect(dueOn(f(), [], '2026-11-25', parent)).toBeNull();
		expect(dueOn(f(['B']), [], '2026-11-23', parent)).toBeNull();
		expect(dueOn(f(['B']), [], '2026-11-24', parent)).toBe('mine');
		// Due with no Variant known: every day counts, a chosen Variant doesn't match.
		expect(dueOn(f(), [], '2026-11-23', () => '')).toBe('mine');
		expect(dueOn(f(['A']), [], '2026-11-23', () => '')).toBeNull();
		// Without its routine it never comes up.
		expect(dueOn(f(), [], '2026-11-23')).toBeNull();
	});

	it('takes the routine’s rule; a routine without one counts all the habits inside', () => {
		expect(rollupRuleOf({ kind: 'interval', every: 1, start: '2026-11-01', variantId: 'v' })).toEqual({ target: null, minimum: null });
		expect(rollupRuleOf({ kind: 'interval', every: 1, start: '2026-11-01', variantId: 'v', rollup: { target: 2, minimum: 1 } })).toEqual({ target: 2, minimum: 1 });
		expect(rollupRuleOf({ kind: 'group', target: 3, minimum: null })).toEqual({ target: 3, minimum: null });
	});

	it('stands on its own with the routine’s days when the routine is gone', () => {
		expect(standaloneSchedule({ kind: 'weekly', days: { 0: 'A', 2: 'B', 4: 'A' } }, f(['A']), '2026-11-01')).toEqual({ kind: 'weekly', days: { 0: 'mine', 4: 'mine' } });
		expect(standaloneSchedule({ kind: 'interval', every: 2, start: '2026-11-01', variantId: 'A' }, f(), '2026-11-10')).toEqual({ kind: 'interval', every: 2, start: '2026-11-01', variantId: 'mine' });
		expect(standaloneSchedule({ kind: 'frequency', times: 3, period: 'week', variantId: 'A' }, f(), '2026-11-10')).toMatchObject({ kind: 'frequency', times: 3, variantId: 'mine' });
		const rot = { kind: 'rotation' as const, step: 'variant' as const, order: [{ variantId: 'A', restDays: 1 }, { variantId: 'B', restDays: 1 }], onMiss: 'wait' as const, weekdays: [], start: '2026-11-01' };
		expect(standaloneSchedule(rot, f(['A']), '2026-11-10')).toEqual({ kind: 'interval', every: 4, start: '2026-11-10', variantId: 'mine' });
		expect(standaloneSchedule(null, f(), '2026-11-10')).toEqual({ kind: 'interval', every: 1, start: '2026-11-10', variantId: 'mine' });
	});
});
