import { describe, expect, it } from 'vitest';
import { cursor, difference, follow, rowText, rowsName, rowsText, skippedName, type Field, type RowState } from './run';

const weight: Field = { id: 'w', name: 'Weight', type: 'number', unit: 'kg', prefill: 'last', choices: null };
const reps: Field = { id: 'r', name: 'Reps', type: 'count', unit: null, prefill: 'target', times: true, choices: null };
const grip: Field = { id: 'g', name: 'Grip', type: 'choice', unit: null, prefill: 'last', choices: [{ id: 'o', name: 'Overhand' }] };
const fields = [weight, reps, grip];
const row = (w: number | null, r: number | null = 8, o: Partial<RowState> = {}): RowState => ({ done: false, values: { w, r }, ...o });

describe('the open row', () => {
	const places = [
		{ key: 'a', sets: [row(60, 8, { done: true }), row(60)] },
		{ key: 'b', sets: [row(40), row(40)] }
	];
	it('is the first left, in the place you are in before the others', () => {
		expect(cursor(places, null, null)).toEqual({ key: 'a', set: 1 });
		expect(cursor(places, null, 'b')).toEqual({ key: 'b', set: 0 });
	});
	it('is the one chosen while it is there', () => {
		expect(cursor(places, { key: 'a', set: 0 }, 'b')).toEqual({ key: 'a', set: 0 });
		expect(cursor(places, { key: 'a', set: 9 }, 'b')).toEqual({ key: 'b', set: 0 });
	});
	it('goes on elsewhere when the place is done, and is none when all is', () => {
		const done = places.map((p) => ({ ...p, sets: p.sets.map((s) => ({ ...s, done: p.key === 'a' ? true : s.done })) }));
		expect(cursor(done, null, 'a')).toEqual({ key: 'b', set: 0 });
		expect(cursor(done.map((p) => ({ ...p, sets: p.sets.map((s) => ({ ...s, done: true })) })), null, 'a')).toBeNull();
	});
});

describe('rows still to do follow a changed number', () => {
	const base = [row(60), row(60), row(55)];
	it('moves them by as much, from where each started', () => {
		const sets = [row(62.5, 8, { done: true, own: ['w'] }), row(60), row(55)];
		expect(follow(sets, base, 0, fields).map((s) => s.values.w)).toEqual([62.5, 62.5, 57.5]);
	});
	it('moves them again, not on top, when a later row changes', () => {
		const sets = [row(62.5, 8, { done: true, own: ['w'] }), row(65, 8, { own: ['w'] }), row(57.5)];
		expect(follow(sets, base, 1, fields).map((s) => s.values.w)).toEqual([62.5, 65, 60]);
	});
	it('leaves rows done, fields changed by hand, and numbers that start from a target', () => {
		const sets = [row(62.5, 6, { done: true, own: ['w', 'r'] }), row(60, 8, { done: true }), row(50, 8, { own: ['w'] })];
		expect(follow(sets, base, 0, fields)).toEqual(sets);
		expect(follow([row(60, 6, { own: ['r'] }), row(60), row(55)], base, 0, fields).map((s) => s.values.r)).toEqual([6, 8, 8]);
	});
	it('takes the value itself when there is nothing to start from, and never goes under zero', () => {
		expect(follow([row(40, 8, { own: ['w'] }), row(null)], [row(null), row(null)], 0, fields)[1].values.w).toBe(40);
		expect(follow([row(0, 8, { own: ['w'] }), row(5)], [row(20), row(5)], 0, fields)[1].values.w).toBe(0);
	});
	it('does nothing when it was not changed by hand', () => {
		const sets = [row(62.5, 8, { done: true }), row(60)];
		expect(follow(sets, base, 0, fields)[1].values.w).toBe(60);
	});
});

describe('what a row says', () => {
	it('joins numbers with × and the rest after them, leaving out what is empty', () => {
		expect(rowText(fields, { w: 62.5, r: 8, g: 'o' })).toBe('62.5 kg × 8 · Overhand');
		expect(rowText(fields, { w: null, r: 8 })).toBe('8');
		expect(rowText(fields, {})).toBe('');
	});
	it('lists the last number while the rest is the same', () => {
		expect(rowsText([weight, reps], [row(60, 8), row(60, 8), row(60, 7)])).toBe('60 kg × 8, 8, 7');
		expect(rowsText([weight, reps], [row(60, 8), row(60, 8)])).toBe('2 × 60 kg × 8');
		expect(rowsText([weight, reps], [row(60, 8), row(62.5, 6)])).toBe('60 kg × 8, 62.5 kg × 6');
	});
	it('names the rows done and the ones passed over', () => {
		const d = { done: true };
		expect(rowsName([row(1, 1, d)], 'set', 'sets')).toBe('Set 1');
		expect(rowsName([row(1, 1, d), row(1, 1, d)], 'set', 'sets')).toBe('Sets 1–2');
		const skip = [row(1, 1, d), row(1), row(1, 1, d)];
		expect(rowsName(skip, 'set', 'sets')).toBe('Sets 1, 3');
		expect(skippedName(skip, 'set')).toBe('set 2 not done');
	});
	it('tells a difference in words', () => {
		expect(difference(62.5, 60, 'kg')).toBe('+2.5 kg');
		expect(difference(7, 8, null)).toBe('−1');
		expect(difference(8, 8, null)).toBe('');
		expect(difference(8, null, null)).toBe('');
	});
});
