import { describe, expect, it } from 'vitest';
import { dayOrder, inRange, logicalDate, rangeAt } from './day';

describe('day start', () => {
	it('counts the small hours as the day before', () => {
		expect(logicalDate('2026-11-21', '01:30', '04:00')).toBe('2026-11-20');
		expect(logicalDate('2026-11-21', '04:00', '04:00')).toBe('2026-11-21');
		expect(logicalDate('2026-11-21', '00:10')).toBe('2026-11-21');
	});
	it('crosses month and year ends', () => {
		expect(logicalDate('2027-01-01', '02:00', '03:00')).toBe('2026-12-31');
	});
	it('sorts by the order the day is lived', () => {
		expect(dayOrder('23:00', '04:00')).toBeLessThan(dayOrder('01:00', '04:00'));
		expect(dayOrder('05:00', '04:00')).toBeLessThan(dayOrder('23:00', '04:00'));
	});
});

describe('named ranges', () => {
	const ranges = [
		{ name: 'Morning', start: '05:00', end: '11:00' },
		{ name: 'Night', start: '22:00', end: '05:00' }
	];
	it('finds the range a time is in, wrapping past midnight', () => {
		expect(rangeAt(ranges, '06:00')?.name).toBe('Morning');
		expect(rangeAt(ranges, '23:30')?.name).toBe('Night');
		expect(rangeAt(ranges, '02:00')?.name).toBe('Night');
		expect(rangeAt(ranges, '12:00')).toBeNull();
	});
	it('treats the end as exclusive', () => {
		expect(inRange(ranges[0], '11:00')).toBe(false);
		expect(inRange(ranges[1], '05:00')).toBe(false);
	});
});

import { isPaused, pauseOn } from './pause';

describe('pauses', () => {
	const pauses = [
		{ habitId: 'gym', start: '2026-12-01', end: '2026-12-03' },
		{ habitId: null, start: '2026-12-24', end: '2026-12-26' }
	];
	it('covers inclusive dates for one habit', () => {
		expect(isPaused(pauses, 'gym', '2026-12-01')).toBe(true);
		expect(isPaused(pauses, 'gym', '2026-12-03')).toBe(true);
		expect(isPaused(pauses, 'gym', '2026-12-04')).toBe(false);
		expect(isPaused(pauses, 'read', '2026-12-02')).toBe(false);
	});
	it('a vacation pauses every habit', () => {
		expect(pauseOn(pauses, 'read', '2026-12-25')?.end).toBe('2026-12-26');
	});
});
