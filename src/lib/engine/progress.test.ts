import { describe, expect, it } from 'vitest';
import { isPartial, progressOf, progressText, type ProgressSlot } from './progress';

const water: ProgressSlot = {
	path: 's-water',
	taskId: 'water',
	metrics: [{ id: 'glasses', name: 'Glasses', type: 'count', unit: '', repeats: false, step: 1 }],
	kids: 0,
	targets: { glasses: 6 }
};
const yesNo = (id: string, path = `s-${id}`): ProgressSlot => ({ path, taskId: id, metrics: [], kids: 0, targets: {} });

describe('progress', () => {
	it('counts toward one target: "3 of 6 glasses"', () => {
		const p = progressOf([water], [{ taskId: 'water', values: { glasses: 3, _summary: true } }], 'due');
		expect(p).toMatchObject({ kind: 'amount', value: 3, target: 6 });
		expect(progressText(p!)).toBe('3 of 6 glasses');
		expect(isPartial(p)).toBe(true);
	});

	it('shows 0 of the target before anything is logged, so +1 can start', () => {
		expect(progressOf([water], [], 'due')).toMatchObject({ kind: 'amount', value: 0, target: 6 });
	});

	it('uses the unit when there is one', () => {
		const read: ProgressSlot = {
			path: 's-read',
			taskId: 'read',
			metrics: [
				{ id: 'min', name: 'Time', type: 'duration', unit: '', repeats: false, step: 5 },
				{ id: 'book', name: 'Book', type: 'text', unit: '', repeats: false, step: null }
			],
			kids: 0,
			targets: { min: 30 }
		};
		expect(progressText(progressOf([read], [{ taskId: 'read', values: { min: 20, book: 'Dune' } }], 'due')!)).toBe('20 of 30 min');
	});

	it('counts steps: Yes or no Tasks, steps inside a Task and logged Tasks', () => {
		const chores = [
			yesNo('dishes'),
			yesNo('trash'),
			{ path: 's-clean', taskId: 'clean', metrics: [], kids: 2, targets: {} },
			yesNo('sink', 's-clean/sink'),
			yesNo('mirror', 's-clean/mirror')
		];
		const p = progressOf(chores, [
			{ taskId: 'dishes', path: 's-dishes', values: { done: true } },
			// A tick from before paths still finds its place.
			{ taskId: 'sink', values: { done: true } }
		], 'done');
		expect(p).toEqual({ kind: 'steps', done: 2, total: 4 });
		expect(progressText(p!)).toBe('2 of 4 steps');
		expect(isPartial(p)).toBe(true);
	});

	it('a full log is not partial', () => {
		const p = progressOf([yesNo('a'), yesNo('b')], [{ taskId: 'a', values: { done: true } }, { taskId: 'b', values: { done: true } }], 'done');
		expect(isPartial(p)).toBe(false);
	});

	it('says nothing for one step, or for a finished log with no entries (an old one-tap Done)', () => {
		expect(progressOf([yesNo('a')], [], 'due')).toBeNull();
		expect(progressOf([yesNo('a'), yesNo('b')], [], 'done')).toBeNull();
		expect(progressOf([water], [], 'done')).toBeNull();
	});

	it('a habit with sets or two targets counts steps, not an amount', () => {
		const bench: ProgressSlot = {
			path: 's-bench',
			taskId: 'bench',
			metrics: [{ id: 'kg', name: 'Weight', type: 'number', unit: 'kg', repeats: true, step: 2.5 }],
			kids: 0,
			targets: { kg: 80 }
		};
		const p = progressOf([bench, water], [{ taskId: 'bench', values: { kg: 80 } }], 'due');
		expect(p).toEqual({ kind: 'steps', done: 1, total: 2 });
	});

	it('counts each round of a Circuit, at the path each value sits at', () => {
		const push = (r: number): ProgressSlot => ({ path: `s#${r}/p`, taskId: 'push', metrics: [{ id: 'reps', name: 'Reps', type: 'count', unit: '', repeats: false, step: 1 }], kids: 0, targets: {} });
		const circuit: ProgressSlot = { path: 's', taskId: 'circuit', metrics: [], kids: 1, targets: {} };
		const p = progressOf([circuit, push(1), push(2), push(3)], [
			{ taskId: 'push', path: 's#1/p', values: { reps: 10, _summary: true } },
			{ taskId: 'push', path: 's#2/p', values: { reps: 8, _summary: true } }
		], 'due');
		expect(p).toEqual({ kind: 'steps', done: 2, total: 3 });
	});
});
