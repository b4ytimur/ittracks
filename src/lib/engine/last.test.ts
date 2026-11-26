import { describe, expect, it } from 'vitest';
import { lastOf, lastText, whenText } from './last';
import { counts, isTracker } from './scoring';

const kg = (v: number | string) => `${v} kg`;

describe('the last value headline', () => {
	it('is the latest point, with the change since the latest one a week or more before it', () => {
		const l = lastOf([
			{ date: '2026-11-10', value: 83.4 },
			{ date: '2026-11-18', value: 83 },
			{ date: '2026-11-20', value: 82.9 },
			{ date: '2026-11-26', value: 82.4 }
		]);
		expect(l).toEqual({ date: '2026-11-26', value: 82.4, change: -0.6 });
		expect(lastText(l!, '2026-11-26', kg)).toBe('82.4 kg · −0.6 kg in a week');
	});

	it('has no change without a point a week back, and says when it was logged', () => {
		const l = lastOf([{ date: '2026-11-24', value: 7 }, { date: '2026-11-25', value: 8 }])!;
		expect(l.change).toBeNull();
		expect(lastText(l, '2026-11-26', String)).toBe('8, yesterday');
	});

	it('says a choice as a word, with no change', () => {
		const l = lastOf([{ date: '2026-11-01', value: 3 }, { date: '2026-11-20', value: 'good' }])!;
		expect(l).toEqual({ date: '2026-11-20', value: 'good', change: null });
		expect(lastText(l, '2026-11-26', (v) => (v === 'good' ? 'Good' : String(v)))).toBe('Good, 6 days ago');
	});

	it('says a gain with a plus and no change with ±', () => {
		expect(lastText({ date: '2026-11-26', value: 5, change: 1 }, '2026-11-26', String)).toBe('5 · +1 in a week');
		expect(lastText({ date: '2026-11-26', value: 5, change: 0 }, '2026-11-26', String)).toBe('5 · ±0 in a week');
	});

	it('is nothing with nothing logged', () => {
		expect(lastOf([])).toBeNull();
	});

	it('says older days as a date', () => {
		expect(whenText('2026-11-26', '2026-11-26')).toBe('');
		expect(whenText('2026-11-23', '2026-11-26')).toBe('3 days ago');
		expect(whenText('2026-10-12', '2026-11-26')).toMatch(/12/);
	});
});

describe('scoring', () => {
	it('a tracker never counts; a break habit set to track still counts its slips', () => {
		expect(counts({ scoring: 'track' })).toBe(false);
		expect(counts({ scoring: 'habit' })).toBe(true);
		expect(counts({})).toBe(true);
		expect(isTracker({ direction: 'build', scoring: 'track' })).toBe(true);
		expect(isTracker({ direction: 'break', scoring: 'track' })).toBe(false);
	});
});
