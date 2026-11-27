// Areas are kept where they stand, in Use (MO): grouped by Area each Area's heading has a grip and a ⋯ (Rename, Colour
// and icon, Delete), and a New Area slot ends the list; selecting, none of it shows. GroupHeading draws the ⋯ and the box.
import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import AreaGroups from './AreaGroups.svelte';
import GroupHeading from './GroupHeading.svelte';
import { mergeOrder } from './list';
import { groupBy } from '$lib/views';

const areas = [
	{ id: 'a1', name: 'Fitness', icon: '', color: '#cc3333' },
	{ id: 'a2', name: 'Learning', icon: '', color: '#3366cc' }
];
const items = [{ id: 'h1', areaId: 'a1', direction: 'build' }, { id: 'h2', areaId: null, direction: 'build' }];
const group = createRawSnippet(() => ({ render: () => '<ul class="rows"></ul>' }));
/** The markup without hydration marks, scoped class names or whitespace between tags. */
const bare = (body: string) => body.replace(/<!--.*?-->/g, '').replace(/\s*svelte-\w+/g, '').replace(/>\s+</g, '><');
const html = (p: Record<string, unknown>) => bare(render(AreaGroups, { props: { areas, group, ...p } as never }).body);
const byArea = (p: Record<string, unknown> = {}) => html({ groups: groupBy(items, 'area', { areas }, { keepEmpty: true }), byArea: true, allAreas: true, ...p });
const menuOf = (body: string, name: string) => {
	const tail = body.slice(body.indexOf(`aria-label="More on ${name}"`));
	return [...tail.slice(0, tail.indexOf('</div>')).matchAll(/<span class="menu-label">([^<]*)/g)].map((m) => m[1]);
};

describe('AreaGroups grouped by Area, in Use', () => {
	it("each Area's heading has a grip and a ⋯ with Rename, Colour and icon, and Delete", () => {
		const b = byArea();
		for (const name of ['Fitness', 'Learning']) {
			expect(b).toContain(`aria-label="Move ${name}"`);
			expect(menuOf(b, name)).toEqual(['Rename', 'Colour and icon', 'Delete']);
		}
	});
	it('an empty Area shows, with its count', () => {
		const b = byArea();
		expect(b).toContain('Learning</span><span class="tags"><span class="tag count">0</span>');
	});
	it('No area has neither: it is no Area to keep', () => {
		const b = byArea();
		expect(b).not.toContain('Move No area');
		expect(b).not.toContain('More on No area');
	});
	it('a New Area slot ends the list', () => {
		expect(byArea()).toMatch(/<li class="ghost"><button type="button" class="ghost-slot"><span aria-hidden="true">\+<\/span><span>New Area<\/span><\/button><\/li><\/ul>/);
	});
	it('a filter hides some Areas: their grips and ⋯ stay, New Area waits, since a new one would not show', () => {
		const b = html({ groups: groupBy(items, 'area', { areas }), byArea: true });
		expect(b).toContain('aria-label="Move Fitness"');
		expect(menuOf(b, 'Fitness')).toEqual(['Rename', 'Colour and icon', 'Delete']);
		expect(b).not.toContain('Learning');
		expect(b).not.toContain('New Area');
	});
	it('a move among the Areas shown keeps the hidden ones in their places', () => {
		// AreaGroups sends mergeOrder(every Area, the shown ones moved): the server puts any left out at the end.
		expect(mergeOrder(['a1', 'a2', 'a3', 'a4'], ['a4', 'a2'])).toEqual(['a1', 'a4', 'a3', 'a2']);
	});
	it("every heading's slot is open, so the titles keep the rows' column", () => {
		const b = byArea();
		expect([...b.matchAll(/<h2 class="group-heading section-title([^"]*)"/g)].map((m) => m[1].trim())).toEqual(['slotted', 'slotted', 'slotted']);
	});
});

describe('AreaGroups while selecting', () => {
	it('no grips, no ⋯ and no New Area: a tap ticks rows', () => {
		const b = byArea({ selecting: true });
		expect(b).not.toContain('aria-label="Move ');
		expect(b).not.toContain('aria-label="More on ');
		expect(b).not.toContain('New Area');
		expect(b).toContain('Fitness');
	});
});

describe('AreaGroups not grouped by Area', () => {
	const groups = [
		{ key: 'build', label: 'Building', color: null, items: [items[0]] },
		{ key: 'break', label: 'Breaking', color: null, items: [items[1]] }
	];
	it('plain headings, their slot open only beside rows with grips or checkboxes', () => {
		for (const slotOpen of [false, true]) {
			const b = html({ groups, byArea: false, slotOpen });
			expect(b).not.toContain('aria-label="More on ');
			expect(b).not.toContain('New Area');
			expect(b.match(/<h2 class="group-heading section-title( slotted)?"/g)!.every((h) => h.includes('slotted') === slotOpen)).toBe(true);
		}
	});
});

describe('GroupHeading', () => {
	const head = (p: Record<string, unknown>) => bare(render(GroupHeading, { props: { title: 'Fitness', ...p } }).body);
	it('a renamable title is plain text until Rename opens it as a box with the name in it', () => {
		const onrename = () => {};
		expect(head({ onrename })).toMatch(/<span class="title" id="[^"]*">Fitness<\/span>/);
		expect(head({ onrename })).not.toMatch(/<(input|button)/);
		expect(head({ onrename, renaming: true })).toMatch(/<input class="inline-text"[^>]*value="Fitness"[^>]*aria-label="Name of Fitness"/);
	});
	it('its acts sit in a ⋯ at the end, in a wrapper the menu hangs from', () => {
		const b = head({ more: [{ label: 'Rename', onselect: () => {} }] });
		expect(b).toMatch(/<span class="more"><button type="button" class="quiet glyph" aria-label="More on Fitness" aria-haspopup="menu"/);
		expect(b).toMatch(/<span class="more">[^]*<\/span><\/h2>$/);
		expect(head({})).not.toContain('class="more"');
	});
});
