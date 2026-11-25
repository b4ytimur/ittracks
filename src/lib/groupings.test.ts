import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS, groupingsProblem, groupTable, readGroupings, starterGroupings, type Grouping } from './groupings';

const skills: Grouping = { id: 's', name: 'Skills', one: 'skill', levels: [{ id: 1, name: 'focus', weight: 1 }, { id: 3, name: 'some', weight: 0.3 }, { id: 2, name: 'warm-up', weight: 0 }] };

describe('groupings', () => {
	it('count what they counted before they were data', () => {
		const w = { high: 0.9, medium: 0.4, low: 0.1 };
		const t = groupTable(readGroupings(undefined, w));
		for (const [level, weight] of [[3, w.high], [2, w.medium], [1, w.low], [4, w.high]] as const) expect(t.weight('chest', level)).toBe(weight);
		for (const level of [0, 1, 2, 3]) expect(t.rank('chest', level)).toBe(level);
		expect([1, 2, 3].map((l) => t.levelName('chest', l))).toEqual(['low', 'medium', 'high']);
		expect(groupTable(readGroupings(undefined)).weight('chest', 1)).toBe(DEFAULT_WEIGHTS.low);
	});
	it('a tag belongs to the one it was put in, else the first', () => {
		const t = groupTable([...starterGroupings(), skills], { scales: 's', lost: 'gone' });
		expect(t.of('Scales ').name).toBe('Skills');
		expect(t.of('chest').name).toBe('Tags');
		expect(t.of('lost').name).toBe('Tags');
	});
	it('levels stand by their order, not their number', () => {
		const t = groupTable([skills]);
		expect([1, 3, 2].map((l) => t.rank('scales', l))).toEqual([3, 2, 1]);
		expect(t.weight('scales', 3)).toBe(0.3);
	});
	it('a level off the list still counts where it is', () => {
		const t = groupTable([{ ...skills, levels: skills.levels.map((l) => (l.id === 3 ? { ...l, off: true } : l)) }]);
		expect(t.weight('scales', 3)).toBe(0.3);
		expect(t.levelName('scales', 3)).toBe('some');
	});
	it('a list that can’t be is refused with its reason', () => {
		expect(groupingsProblem([...starterGroupings(), skills])).toBe('');
		expect(groupingsProblem([skills, { ...skills, id: 'x' }])).toBe('Two groupings are called “Skills”');
		expect(groupingsProblem([{ ...skills, levels: skills.levels.map((l) => ({ ...l, off: true })) }])).toBe('Skills needs a level');
		expect(groupingsProblem([{ ...skills, levels: [skills.levels[0], { id: 9, name: 'FOCUS', weight: 0 }] }])).toMatch(/two levels called/);
		expect(readGroupings([{ broken: 1 }])[0].name).toBe('Muscle groups');
		expect(readGroupings([])[0].levels).toHaveLength(3);
	});
});
