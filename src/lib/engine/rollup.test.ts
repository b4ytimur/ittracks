import { describe, expect, it } from 'vitest';
import { rollupDay, rollupText } from './rollup';

const all = { target: null, minimum: null };
const days = (...s: ('due' | 'done' | 'skipped' | 'missed')[]) => s.map((status) => ({ status }));

describe('rollupDay: a group day from the habits inside it', () => {
	it('is done when every habit due is done', () => {
		expect(rollupDay(days('done', 'done'), all, { past: true })).toEqual({ status: 'done', level: null, done: 2, total: 2 });
	});

	it('stays due today while a habit inside is still due', () => {
		expect(rollupDay(days('done', 'due'), all, { past: false })).toMatchObject({ status: 'due', done: 1, total: 2 });
	});

	it('is missed once the day is over and it fell short', () => {
		expect(rollupDay(days('done', 'missed'), all, { past: true })).toMatchObject({ status: 'missed', done: 1, total: 2 });
	});

	it('a target of N needs N of the habits due, or all of them when fewer were due', () => {
		const two = { target: 2, minimum: null };
		expect(rollupDay(days('done', 'done', 'missed'), two, { past: true })?.status).toBe('done');
		expect(rollupDay(days('done', 'missed', 'missed'), two, { past: true })?.status).toBe('missed');
		expect(rollupDay(days('done'), two, { past: true })?.status).toBe('done');
	});

	it('a day that reaches the Minimum is done at the Minimum', () => {
		const r = rollupDay(days('done', 'missed', 'missed'), { target: null, minimum: 1 }, { past: true });
		expect(r).toMatchObject({ status: 'done', level: 'minimum', done: 1, total: 3 });
	});

	it('today, the Minimum counts once nothing inside is left to do', () => {
		const rule = { target: null, minimum: 1 };
		expect(rollupDay(days('done', 'due'), rule, { past: false })?.status).toBe('due');
		expect(rollupDay(days('done', 'skipped', 'missed'), rule, { past: false })).toMatchObject({ status: 'done', level: 'minimum' });
	});

	it('skipped habits count neither way; all skipped makes a skipped day', () => {
		expect(rollupDay(days('done', 'skipped'), all, { past: true })).toMatchObject({ status: 'done', done: 1, total: 1 });
		expect(rollupDay(days('skipped', 'skipped'), all, { past: true })).toMatchObject({ status: 'skipped', total: 0 });
	});

	it('nothing due inside means no day; extra logs and unjudged past days do not count', () => {
		expect(rollupDay([], all, { past: true })).toBeNull();
		expect(rollupDay([{ status: 'done', extra: true }], all, { past: true })).toBeNull();
		expect(rollupDay([{ status: 'done' }, { status: 'due' }], all, { past: true })).toMatchObject({ status: 'done', total: 1 });
	});

	it('says how many were done', () => {
		expect(rollupText({ done: 2, total: 3 })).toBe('2 of 3 habits');
		expect(rollupText({ done: 1, total: 1 })).toBe('1 of 1 habit');
	});
});
