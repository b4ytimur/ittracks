import { describe, expect, it } from 'vitest';
import { checkParts, childPath, expand, parentPath, parsePath, PATH_RE, place, slotOfPath, startsRound, withoutRounds, type PartRow, type Top } from './parts';

const none = { targets: null, minTargets: null, stretchTargets: null };
const part = (id: string, taskId: string, childTaskId: string, extra: Partial<PartRow> = {}): PartRow => ({
	id,
	taskId,
	childTaskId,
	sets: null,
	sortOrder: 0,
	archived: false,
	...none,
	...extra
});
const top = (slotId: string, taskId: string, sets: number | null = null): Top => ({ slotId, taskId, sets, ...none });
const opts = (parts: PartRow[], perSet: string[] = []) => ({
	partsOf: (t: string) => parts.filter((p) => p.taskId === t),
	perSet: (t: string) => perSet.includes(t)
});

describe('paths', () => {
	it('carry the Slot, the parts and the rounds', () => {
		expect(childPath('s1', null, 'p1')).toBe('s1/p1');
		expect(childPath('s1', 2, 'p1')).toBe('s1#2/p1');
		expect(parsePath('s1#2/p1/p2')).toEqual([{ id: 's1', round: 2 }, { id: 'p1', round: null }, { id: 'p2', round: null }]);
		expect(slotOfPath('s1#2/p1')).toBe('s1');
		expect(withoutRounds('s1#2/p1#3/p2')).toBe('s1/p1/p2');
		expect(parentPath('s1#2/p1')).toBe('s1');
		expect(parentPath('s1/p1/p2')).toBe('s1/p1');
		expect(parentPath('s1')).toBeNull();
		expect(PATH_RE.test('3f2a/p-1#2/x_y')).toBe(true);
		expect(PATH_RE.test('a/../b')).toBe(false);
	});
});

describe('expand', () => {
	it('lists a Slot with its parts, and parts inside parts', () => {
		const parts = [part('p1', 'circuit', 'push'), part('p2', 'circuit', 'squat'), part('p3', 'squat', 'warm')];
		const ps = expand([top('s', 'circuit')], opts(parts));
		expect(ps.map((p) => [p.path, p.taskId, p.depth])).toEqual([
			['s', 'circuit', 0],
			['s/p1', 'push', 1],
			['s/p2', 'squat', 1],
			['s/p2/p3', 'warm', 2]
		]);
		expect(ps[0].kids).toBe(2);
	});

	it('repeats parts once per set when the Task has no per-set fields of its own', () => {
		const parts = [part('p1', 'circuit', 'push'), part('p2', 'circuit', 'squat')];
		const ps = expand([top('s', 'circuit', 3)], opts(parts));
		expect(ps.map((p) => p.path)).toEqual(['s', 's#1/p1', 's#1/p2', 's#2/p1', 's#2/p2', 's#3/p1', 's#3/p2']);
		expect(ps[3].round).toEqual({ n: 2, of: 3 });
		expect([1, 2, 3, 4].map((i) => startsRound(ps, i))).toEqual([true, false, true, false]);
		// With per-set fields, the sets are its own and the parts show once.
		expect(expand([top('s', 'circuit', 3)], opts(parts, ['circuit'])).map((p) => p.path)).toEqual(['s', 's/p1', 's/p2']);
	});

	it('never loops, and leaves out archived parts unless the log has values under them', () => {
		const parts = [part('p1', 'a', 'b'), part('p2', 'b', 'a'), part('p3', 'a', 'c', { archived: true })];
		expect(expand([top('s', 'a')], opts(parts)).map((p) => p.path)).toEqual(['s', 's/p1']);
		expect(expand([top('s', 'a')], { ...opts(parts), keep: (id) => id === 'p3' }).map((p) => p.path)).toEqual(['s', 's/p1', 's/p3']);
	});

	it('stops at the depth cap', () => {
		const chain = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];
		const parts = chain.slice(1).map((c, i) => part(`p${i}`, chain[i], c));
		expect(Math.max(...expand([top('s', 't0')], opts(parts)).map((p) => p.depth))).toBe(4);
	});
});

describe('place', () => {
	const ps = expand([top('s1', 'read'), top('s2', 'read'), top('s3', 'list')], opts([part('step', 'list', 'step')]));

	it('puts Entries at their path, and keeps ones no place holds', () => {
		const r = place(ps, [
			{ taskId: 'read', path: 's2', values: { m: 1 } },
			{ taskId: 'gone', path: 's3/old', values: { done: true } }
		]);
		expect(r.at.get('s2')).toHaveLength(1);
		expect(r.orphans).toHaveLength(1);
	});

	it('places Entries from before paths by Task and order', () => {
		const r = place(ps, [
			{ taskId: 'read', values: { m: 10, _summary: true } },
			{ taskId: 'read', values: { m: 20, _summary: true } },
			{ taskId: 'step', values: { done: true } }
		]);
		expect(r.at.get('s1')?.[0].values.m).toBe(10);
		expect(r.at.get('s2')?.[0].values.m).toBe(20);
		expect(r.at.get('s3/step')).toHaveLength(1);
	});
});

describe('checkParts', () => {
	const name = (id: string) => id.toUpperCase();
	it('refuses a Task inside itself, directly or further down', () => {
		expect(checkParts([], 'a', ['a'], name)).toMatch(/inside itself/);
		const others = [part('p1', 'b', 'c'), part('p2', 'c', 'a')];
		expect(checkParts(others, 'a', ['b'], name)).toMatch(/B already has this Task inside it/);
		expect(checkParts(others, 'a', ['d'], name)).toBeNull();
	});
	it('refuses a tree deeper than the cap, counting what the Task already sits under', () => {
		const others = [part('p1', 'x', 'y'), part('p2', 'y', 'a'), part('p3', 'c', 'd'), part('p4', 'd', 'e')];
		// a sits 2 deep; c brings 3 more levels (c, d, e): 5 > 4.
		expect(checkParts(others, 'a', ['c'], name)).toMatch(/4 levels/);
		expect(checkParts(others, 'a', ['d'], name)).toBeNull();
	});
});
