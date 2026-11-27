import { expect, it } from 'vitest';
import { customOrder, everySection, movedSections } from './sections';

it('a section keeps its place while it is not shown', () => {
	const full = everySection();
	// "When you slip" is not on this kind's page.
	const moved = movedSections(full, ['about', 'what', 'counts', 'keeps']);
	expect(moved).toEqual(['about', 'what', 'slip', 'counts', 'keeps']);
	expect(everySection(moved)).toEqual(moved);
	expect(everySection(['keeps', 'gone'])).toEqual(['keeps', 'what', 'counts', 'slip', 'about']);
});

it('there is a section order to reset only when it differs from the one every kind starts with', () => {
	expect(customOrder()).toBe(false);
	expect(customOrder([])).toBe(false);
	expect(customOrder(everySection())).toBe(false); // moved back by hand: nothing to reset
	expect(customOrder(['what', 'gone'])).toBe(false); // what is no longer a section doesn't count
	expect(customOrder(['about'])).toBe(true);
	expect(customOrder(movedSections(everySection(), ['about', 'what', 'counts', 'keeps']))).toBe(true);
});
