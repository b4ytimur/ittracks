import { expect, it } from 'vitest';
import { circuitsOf, roundWords } from './circuit';

const item = (path: string, kids = 0, inRows = false) => ({ path, kids, inRows });

it('finds the rounds of a Task and their stations', () => {
	const items = [item('a', 0, true), item('b', 2), item('b#1/x'), item('b#1/y', 0, true), item('b#2/x'), item('b#2/y', 0, true), item('c')];
	expect([...circuitsOf(items).values()]).toEqual([{ at: 1, rounds: [[2, 3], [4, 5]] }]);
});
it('leaves one round, sets of its own, and stations that hold something alone', () => {
	expect(circuitsOf([item('b', 1), item('b/x')]).size).toBe(0);
	expect(circuitsOf([item('b', 1, true), item('b/x')]).size).toBe(0);
	const nested = [item('b', 1), item('b#1/x', 1), item('b#1/x/z'), item('b#2/x', 1), item('b#2/x/z')];
	expect(circuitsOf(nested).size).toBe(0);
	// A circuit inside a Task is one too.
	expect([...circuitsOf([item('s', 1), item('s/p', 1), item('s/p#1/x'), item('s/p#2/x')]).keys()]).toEqual([1]);
});
it('calls a round by the Task’s own word', () => {
	expect([roundWords({ rowOne: 'set', rowMany: 'sets' }).one, roundWords({ rowOne: 'lap', rowMany: 'laps' }).many]).toEqual(['round', 'laps']);
});
