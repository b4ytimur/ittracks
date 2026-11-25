import { describe, expect, it } from 'vitest';
import { dayCount, dayMark, placeNotes } from './day';

const o = (status: string, extra = false) => ({ status, extra });

describe('a day', () => {
	it('counts what is done of what was due', () => {
		expect(dayCount([o('done'), o('missed'), o('due')])).toEqual({ done: 1, of: 3 });
	});
	it('leaves out skips and logs on days off', () => {
		expect(dayCount([o('done'), o('skipped'), o('done', true)])).toEqual({ done: 1, of: 1 });
	});
	it('counts a group or routine through the habits inside it', () => {
		expect(dayCount([o('done'), o('due'), { ...o('done'), rollup: { done: 1, total: 2 } }])).toEqual({ done: 1, of: 2 });
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

it('a note stands under its own row, the day’s own first, the rest after', () => {
	const n = (kind: string, habitId: string | null, text: string) => ({ kind, habitId, text });
	const p = placeNotes([n('day', null, 'a'), n('field', 'gym', 'b'), n('log', 'gym', 'c'), n('slip', 'smoke', 'd'), n('log', 'open', 'e')], [{ id: 'o1', habitId: 'gym' }], [{ habitId: 'smoke' }, { habitId: 'smoke' }]);
	expect(p.day.map((x) => x.text)).toEqual(['a']);
	expect([...p.row].map(([k, v]) => [k, v.map((x) => x.text)])).toEqual([['o1', ['b', 'c']]]);
	// Two slips of one habit: under the last.
	expect([...p.slip].map(([k, v]) => [k, v.map((x) => x.text)])).toEqual([[1, ['d']]]);
	expect(p.rest.map((x) => x.text)).toEqual(['e']);
});
