import { describe, expect, it } from 'vitest';
import { deepestFirst, depthOf, descendants, flatten, makesCycle } from './tree';

// morning > (meditate, stretch > (neck, back)); gym on its own.
const nodes = [
	{ id: 'morning', parentId: null },
	{ id: 'meditate', parentId: 'morning' },
	{ id: 'stretch', parentId: 'morning' },
	{ id: 'neck', parentId: 'stretch' },
	{ id: 'back', parentId: 'stretch' },
	{ id: 'gym', parentId: null }
];

describe('habit tree', () => {
	it('finds everything below a habit, at any depth', () => {
		expect([...descendants(nodes, 'morning')].sort()).toEqual(['back', 'meditate', 'neck', 'stretch']);
		expect(descendants(nodes, 'gym').size).toBe(0);
	});

	it('refuses a parent that would make a loop', () => {
		expect(makesCycle(nodes, 'morning', 'neck')).toBe(true);
		expect(makesCycle(nodes, 'morning', 'morning')).toBe(true);
		expect(makesCycle(nodes, 'neck', 'gym')).toBe(false);
	});

	it('knows depth and orders deepest first', () => {
		expect(depthOf(nodes, 'neck')).toBe(2);
		expect(depthOf(nodes, 'gym')).toBe(0);
		const order = deepestFirst(nodes).map((n) => n.id);
		expect(order.indexOf('stretch')).toBeLessThan(order.indexOf('morning'));
		expect(order.indexOf('neck')).toBeLessThan(order.indexOf('stretch'));
	});

	it('flattens in tree order with depth; a habit whose parent is not listed sits at the top', () => {
		expect(flatten(nodes).map((x) => `${x.depth}:${x.node.id}`)).toEqual(['0:morning', '1:meditate', '1:stretch', '2:neck', '2:back', '0:gym']);
		expect(flatten(nodes.filter((n) => n.id !== 'morning')).map((x) => `${x.depth}:${x.node.id}`)).toEqual(['0:meditate', '0:stretch', '1:neck', '1:back', '0:gym']);
	});

	it('never hangs on a loop in old data', () => {
		const loop = [
			{ id: 'a', parentId: 'b' },
			{ id: 'b', parentId: 'a' }
		];
		expect(descendants(loop, 'a')).toEqual(new Set(['b']));
		expect(depthOf(loop, 'a')).toBe(1);
		expect(flatten(loop).map((x) => x.node.id).sort()).toEqual(['a', 'b']);
	});
});
