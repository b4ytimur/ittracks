import { describe, expect, it } from 'vitest';
import { inOrder, numberIn, toCount, withoutSlot, withSlot, withTask, type Plan } from './plan';

const slot = (id: string) => ({ id, taskId: null, fillRule: null, sets: 3, targets: {}, minTargets: {}, stretchTargets: {} });
const plan: Plan = [
	{ id: 'a', name: 'A', slots: [slot('1'), slot('2'), slot('3')] },
	{ id: 'b', name: 'B', slots: [slot('4')] }
];
const ids = (p: Plan) => p.map((v) => v.slots.map((s) => s.id).join('')).join(' ');

describe('editing the plan on a log', () => {
	it('puts Tasks in order and leaves the rest where it is', () => {
		expect(ids(inOrder(plan, ['3', '1', '2']))).toBe('312 4');
		// A log that shows only some of them.
		expect(ids(inOrder(plan, ['3', '1']))).toBe('321 4');
		expect(ids(plan)).toBe('123 4');
	});
	it('changes one Slot', () => {
		expect(withSlot(plan, '2', { sets: 5 })[0].slots.map((s) => s.sets)).toEqual([3, 5, 3]);
	});
	it('adds a Task to one Variant and takes one out', () => {
		expect(ids(withTask(plan, 'b', '9', 't'))).toBe('123 49');
		expect(withTask(plan, 'b', '9', 't')[1].slots[1]).toMatchObject({ taskId: 't', sets: null });
		expect(ids(withoutSlot(plan, '2'))).toBe('13 4');
	});
	it('reads a number out of what was typed', () => {
		expect([numberIn('4 sets'), numberIn('62,5 kg'), numberIn('8'), numberIn('some')]).toEqual([4, 62.5, 8, null]);
	});
	it('never drops a row that is done', () => {
		const rows = [true, true, false].map((done) => ({ done, values: { w: 60 } }));
		expect(toCount(rows, 1).map((r) => r.done)).toEqual([true, true]);
		expect(toCount(rows, 4).at(-1)).toEqual({ done: false, values: { w: 60 } });
	});
});
