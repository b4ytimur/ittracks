import { expect, it } from 'vitest';
import { everySection, movedSections } from './sections';

it('a section keeps its place while it is not shown', () => {
	const full = everySection();
	// "When you slip" is not on this kind's page.
	const moved = movedSections(full, ['about', 'what', 'counts', 'keeps']);
	expect(moved).toEqual(['about', 'what', 'slip', 'counts', 'keeps']);
	expect(everySection(moved)).toEqual(moved);
	expect(everySection(['keeps', 'gone'])).toEqual(['keeps', 'what', 'counts', 'slip', 'about']);
});
