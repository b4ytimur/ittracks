import { describe, expect, it } from 'vitest';
import { besides, doneBefore, doneLine, fromDraft, goneFrom, placeKey, setsToDo, swapText } from './places';

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

	describe('done in a Slot before it was swapped', () => {
		const set = (task: string, path: string | null, kg: number) => ({ taskId: task, path, values: { kg } });
		const legPress = at('s1', 'legpress');
		const extra = [
			set('squat', 's1', 60),
			set('squat', 's1', 62.5),
			{ taskId: 'squat', path: 's1', values: { feel: 'easy', _summary: true } },
			{ taskId: 'plank', path: 's1', values: { done: true } },
			// A part removed, and a value from before paths: gone from the habit, not done here.
			set('curl', 's1/gone', 10),
			set('row', null, 30)
		];

		it('is shown in that Slot, by the Task it was done with, counting only its sets', () => {
			expect(doneBefore(extra, legPress)).toEqual([
				{ taskId: 'squat', sets: 2 },
				{ taskId: 'plank', sets: 0 }
			]);
			expect(doneBefore(extra, press)).toEqual([]);
		});
		it('swapped back, the Task done there is the one shown, so it has no line of its own', () => {
			expect(doneBefore([set('squat', 's1', 60), set('legpress', 's1', 100)], squat)).toEqual([{ taskId: 'legpress', sets: 1 }]);
		});
		it('reads in the Task\'s own words', () => {
			expect(doneLine('Bench press', 2, 'set', 'sets')).toBe('Bench press · 2 sets done');
			expect(doneLine('Bench press', 1, 'set', 'sets')).toBe('Bench press · 1 set done');
			expect(doneLine('Rowing', 3, 'interval', 'intervals')).toBe('Rowing · 3 intervals done');
			expect(doneLine('Plank', 0, 'set', 'sets')).toBe('Plank · done');
		});
		it('only what sits at no place shown is gone from the habit', () => {
			expect(goneFrom(extra, [legPress, press])).toEqual([set('curl', 's1/gone', 10), set('row', null, 30)]);
		});
		it('leaves the new Task the sets still to do, at least 1', () => {
			expect(setsToDo(4, 2)).toBe(2);
			expect(setsToDo(4, 5)).toBe(1);
			expect(setsToDo(4, 0)).toBe(4);
		});
	});

	describe("the band's line for a swap", () => {
		it('says which Task is used instead, for today or the past day only', () => {
			expect(swapText('Bench press', 'Incline bench press', 'swap', 'today only')).toBe('Using Incline bench press instead of Bench press, today only.');
			expect(swapText('Bench press', 'Incline bench press', 'swap', 'Tue 18 Nov only')).toBe('Using Incline bench press instead of Bench press, Tue 18 Nov only.');
			expect(swapText(null, 'Plank', 'swap', 'today only')).toBe('Using Plank, today only.');
		});
		it('back to the plan\'s own Task, says so', () => {
			expect(swapText('Incline bench press', 'Bench press', 'back', 'today only')).toBe('Back to Bench press, as planned.');
		});
		it('names what Pick another picked, and what it showed before', () => {
			expect(swapText('Squat', 'Lunge', 'reroll', 'today only')).toBe('Picked Lunge instead of Squat, today only.');
			expect(swapText(null, 'Lunge', 'reroll', 'today only')).toBe('Picked Lunge, today only.');
		});
	});
});
