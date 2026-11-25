import { describe, expect, it } from 'vitest';
import { dayCount, dayMark } from './day';

const o = (status: string, extra = false) => ({ status, extra });

describe('a day', () => {
	it('counts what is done of what was due', () => {
		expect(dayCount([o('done'), o('missed'), o('due')])).toEqual({ done: 1, of: 3 });
	});
	it('leaves out skips and logs on days off', () => {
		expect(dayCount([o('done'), o('skipped'), o('done', true)])).toEqual({ done: 1, of: 1 });
	});
	it('marks it the same way', () => {
		expect(dayMark([o('done'), o('done')])).toBe('done');
		expect(dayMark([o('done'), o('missed')])).toBe('partial');
		expect(dayMark([o('missed')])).toBe('missed');
		expect(dayMark([o('due')], true)).toBe('due');
		expect(dayMark([o('skipped')])).toBe('skipped');
		expect(dayMark([o('done', true)])).toBe('done');
		expect(dayMark([o('done'), o('skipped')])).toBe('done');
		expect(dayMark([])).toBe('none');
	});
});
