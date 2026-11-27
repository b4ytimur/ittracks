// Archived from its ⋯, a row that was its list's last hands the focus to the next row's ⋯ on the page, else the one before.
// Renamed from its ⋯, the box and then the focus stay with the row whose ⋯ was pressed, though the item has other rows.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backToMore, focusBox, nextHere, pressedRow } from './row-more';

describe('nextHere', () => {
	const here = (gone: string[]) => (x: string) => !gone.includes(x);
	it('the first one after that is still here', () => {
		expect(nextHere(['a', 'b', 'c', 'd'], 1, here(['b', 'c']))).toBe('d');
	});
	it('none after: the nearest before', () => {
		expect(nextHere(['a', 'b', 'c', 'd'], 3, here(['c', 'd']))).toBe('b');
	});
	it('nothing left, or nowhere it was: nothing after or before', () => {
		expect(nextHere(['a'], 0, here(['a']))).toBeUndefined();
		expect(nextHere(['a', 'b'], -1, here([]))).toBe('a');
	});
});

describe('Rename from a row of a habit listed under two Identities', () => {
	afterEach(() => vi.unstubAllGlobals());
	/** Two rows of one habit; a query of the whole page by its key finds the first. */
	function page() {
		const log: string[] = [];
		const el = (name: string, inside: Record<string, unknown> = {}) => ({
			focus: () => log.push(`focus ${name}`),
			select: () => log.push(`select ${name}`),
			querySelector: (s: string) => Object.entries(inside).find(([end]) => s.endsWith(end))?.[1] ?? null
		});
		const row = (name: string) => el(name, { '.verb button': el(`${name} ⋯`), 'input.inline-text': el(`${name} box`) });
		const [first, lower] = [row('first'), row('lower')];
		const body = {};
		const doc = { body, activeElement: body as unknown, querySelector: () => first };
		vi.stubGlobal('document', doc);
		return { log, lower, doc, body };
	}

	it('the row is the one whose ⋯ holds the focus', () => {
		const { lower, doc } = page();
		doc.activeElement = { closest: (s: string) => (s === 'li[data-key]' ? lower : null) };
		expect(pressedRow()).toBe(lower);
	});
	it("the cursor goes into that row's box, and Enter or Esc give the focus back to that row's ⋯", async () => {
		const { log, lower } = page();
		await focusBox(lower as unknown as Element);
		await backToMore(lower as unknown as Element);
		expect(log).toEqual(['focus lower box', 'select lower box', 'focus lower ⋯']);
	});
	it('a press elsewhere keeps the focus it took', async () => {
		const { log, lower, doc } = page();
		doc.activeElement = {};
		await backToMore(lower as unknown as Element);
		expect(log).toEqual([]);
	});
});
