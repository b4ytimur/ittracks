import { describe, expect, it } from 'vitest';
import { addMonths, canStep, isoWeek, markOf, monthEnd, monthWeeks, spanOf, stepOf, total, wordsOf } from './days';

const today = '2026-11-26';
describe('the days block', () => {
	it('numbers weeks the ISO way', () => {
		expect(isoWeek(today)).toBe(48);
		expect(isoWeek('2025-12-29')).toBe(1);
		expect(isoWeek('2027-01-01')).toBe(53);
		expect(isoWeek('2026-01-04')).toBe(1);
	});
	it('spans a week, seven days, a month and the last 12 months', () => {
		expect(spanOf('week', today, today)).toEqual(['2026-11-23', '2026-11-29']);
		expect(spanOf('seven', today, today)).toEqual(['2026-11-20', '2026-11-26']);
		expect(spanOf('month', '2026-02-10', today)).toEqual(['2026-02-01', '2026-02-28']);
		expect(spanOf('year', '2026-03-03', today)).toEqual(['2025-12-01', '2026-11-29']);
	});
	it('steps a month across the year and stops seven days at today', () => {
		expect(addMonths('2026-12-15', 1)).toBe('2027-01-01');
		expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
		expect(monthEnd('2028-02-03')).toBe('2028-02-29');
		expect(stepOf('seven', '2026-11-22', 1, today)).toBe(today);
		expect(stepOf('week', today, -1, today)).toBe('2026-11-19');
	});
	it('goes no further than today or the first day', () => {
		expect(canStep('week', today, 1, today, '2026-01-12')).toBe(false);
		expect(canStep('week', '2026-11-19', 1, today, '2026-01-12')).toBe(true);
		expect(canStep('week', '2026-01-14', -1, today, '2026-01-12')).toBe(false);
		expect(canStep('month', '2026-01-14', -1, today, '2026-01-12')).toBe(false);
		expect(canStep('month', '2026-02-14', -1, today, '2026-01-12')).toBe(true);
		expect(canStep('year', '2025-12-03', -1, today, '2025-01-01')).toBe(false);
		expect(canStep('week', today, -1, today, null)).toBe(false);
	});
	it('rows a month by its weeks: November 2026 has six', () => {
		expect(monthWeeks(today)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
	});
	it('marks a day the way the strips do', () => {
		expect(markOf('2026-11-27', [0, 0], today, '2026-01-01')).toBe('future');
		expect(markOf('2025-12-31', [1, 1], today, '2026-01-01')).toBe('before');
		expect(markOf('2026-11-25', [0, 2], today, '2026-01-01')).toBe('missed');
		expect(markOf(today, [0, 3], today, '2026-01-01')).toBe('due');
		expect(markOf('2026-11-24', [1, 2], today, '2026-01-01')).toBe('partial');
		expect(markOf('2026-11-22', [0, 0], today, '2026-01-01')).toBe('rest');
		expect(wordsOf('missed', [0, 2])).toBe('0 of 2 done');
		expect(total(['a', 'b', 'c'], (d) => (d === 'c' ? undefined : [1, 2]))).toEqual([2, 4]);
	});
});
