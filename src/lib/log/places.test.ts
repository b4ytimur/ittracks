import { describe, expect, it } from 'vitest';
import { fromDraft, placeKey } from './places';

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
});
