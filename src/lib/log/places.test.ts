import { describe, expect, it } from 'vitest';
import { besides, fromDraft, placeKey } from './places';

const at = (path: string, task: string | null) => ({ path, task: task ? { id: task } : null });
const squat = at('s1', 'squat');
const press = at('s2', 'press');

describe('what is being logged, by place', () => {
	it('tells two Tasks in one place, and one Task in two places, apart', () => {
		const keys = [squat, at('s1', 'lunge'), at('s2', 'squat'), at('s1', null)].map(placeKey);
		expect(new Set(keys).size).toBe(4);
	});

	it('gives a place its own values back when a part was added before it', () => {
		const draft = { [placeKey(squat)]: 'squat values', [placeKey(press)]: 'press values' };
		const now = [squat, at('s1/warm-up#1', 'bar'), press];
		const back = fromDraft(draft, now);
		expect(now.map((p) => back[placeKey(p)])).toEqual(['squat values', undefined, 'press values']);
	});

	it('reads a list from before, and leaves one that no longer fits', () => {
		expect(fromDraft(['a', 'b'], [squat, press])).toEqual({ [placeKey(squat)]: 'a', [placeKey(press)]: 'b' });
		expect(fromDraft(['a', 'b'], [squat])).toEqual({});
	});

	describe('what a log saves besides the places it shows', () => {
		const set = (task: string, path: string, kg: number) => ({ taskId: task, path, values: { kg } });
		const legPress = at('s1', 'legpress');

		it('a set ticked at a place swapped away before it was saved goes with the log, under the Task it was done with', () => {
			const held = { [placeKey(squat)]: [set('squat', 's1', 60), set('squat', 's1', 62.5)], [placeKey(press)]: [set('press', 's2', 40)] };
			expect(besides(held, [legPress, press], [])).toEqual([set('squat', 's1', 60), set('squat', 's1', 62.5)]);
		});
		it('what it held there stands for what the server holds there, which it grew from; the server keeps the rest', () => {
			const held = { [placeKey(squat)]: [set('squat', 's1', 60), set('squat', 's1', 62.5)] };
			const server = [set('squat', 's1', 60), set('lunge', 's1', 20), { taskId: 'squat', path: null, values: { kg: 50 } }];
			expect(besides(held, [legPress, press], server)).toEqual([set('squat', 's1', 60), set('squat', 's1', 62.5), set('lunge', 's1', 20), { taskId: 'squat', path: null, values: { kg: 50 } }]);
		});
		it('a place untouched there since it was saved, or unticked before it went, says so', () => {
			const server = [set('squat', 's1', 60)];
			expect(besides({}, [legPress, press], server)).toEqual(server);
			expect(besides({ [placeKey(squat)]: [] }, [legPress, press], server)).toEqual([]);
		});
		it('a place swapped back is shown again, and saved as it shows', () => {
			expect(besides({ [placeKey(squat)]: [set('squat', 's1', 60)] }, [squat, press], [])).toEqual([]);
		});
	});
});
