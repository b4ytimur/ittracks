import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import EditChrome from './EditChrome.svelte';
import TitleLine, { next } from './TitleLine.svelte';

// A key pressed inside `within` (a part of next's selector: textarea, dialog, [popover]), or on the page.
const key = (k: string, { prevented = false, within = '' } = {}) => ({
	key: k,
	defaultPrevented: prevented,
	target: { closest: (sel: string) => (within && sel.split(/,\s*/).includes(within) ? {} : null) } as unknown as EventTarget
});

describe('next: what a press or a key makes of the state', () => {
	it('a press turns it on, and a second press leaves', () => {
		expect(next(false, 'press')).toBe(true);
		expect(next(true, 'press')).toBe(false);
	});
	it('Esc leaves, outside a field', () => {
		expect(next(true, key('Escape'))).toBe(false);
		expect(next(true, { key: 'Escape', defaultPrevented: false, target: null })).toBe(false);
	});
	it('Esc in a field, a popover or a dialog, or one something else took, keeps it on', () => {
		for (const within of ['textarea', 'select', '[popover]', 'dialog']) expect(next(true, key('Escape', { within }))).toBe(true);
		expect(next(true, key('Escape', { prevented: true }))).toBe(true);
	});
	it('Esc while a row is held only puts the row back (EditableList marks <html> .el-dragging)', () => {
		expect(next(true, key('Escape', { within: '.el-dragging' }))).toBe(true);
	});
	it('other keys change nothing, and Esc never turns it on', () => {
		expect(next(true, key('Enter'))).toBe(true);
		expect(next(false, key('Escape'))).toBe(false);
	});
});

describe('TitleLine', () => {
	const props = {
		title: 'Habits',
		back: { href: '/', label: 'Today' },
		add: { label: 'New habit', href: '/habits/new' },
		more: [{ label: 'Gallery', href: '/gallery' }],
		hint: '12 habits'
	};
	const state = (pressed: boolean) => ({ label: 'Select', pressed, onchange: () => {}, hint: 'Tap a habit to tick it.' });
	const html = (p: Record<string, unknown>) => render(TitleLine, { props: { ...props, ...p } }).body.replace(/<!--.*?-->/g, ''); // without hydration marks

	it('in Use: live actions, the Use hint, the state off', () => {
		const b = html({ state: state(false) });
		expect(b).toMatch(/<header class="titlebar[^"]*" data-mode="use"/);
		expect(b).not.toMatch(/class="title-actions" inert/);
		expect(b).toContain('aria-pressed="false"');
		expect(b).toMatch(/<span data-hint="use">12 habits<\/span>/);
		expect(b).toMatch(/<span data-hint="state" inert[^>]*>Tap a habit to tick it\.<\/span>/);
	});
	it('while pressed: the actions are inert, the line pins and the hint states the state', () => {
		const b = html({ state: state(true) });
		expect(b).toMatch(/<header class="titlebar[^"]*" data-mode="state"/);
		expect(b).toMatch(/class="title-actions" inert/);
		expect(b).toContain('aria-pressed="true"');
		expect(b).toMatch(/<p class="hint-line meta" data-mode="state">/);
		expect(b).toMatch(/<span data-hint="use" inert[^>]*>12 habits<\/span>/);
		expect(b).toMatch(/<span data-hint="state">Tap a habit to tick it\.<\/span>/);
	});
	it('the state button stands outside the actions', () => {
		const b = html({ state: state(true) });
		expect(b).toMatch(/<\/div>\s*<button type="button" class="toggle" aria-pressed="true">[^]*?<\/button>\s*<\/header>/);
	});
	it('no state, no button; no hint, no line', () => {
		const b = html({ hint: undefined });
		expect(b).not.toContain('aria-pressed');
		expect(b).not.toContain('hint-line');
	});
	it('the back link is named Back to its page, with the ‹ hidden', () => {
		expect(html({})).toContain('<a class="title-back" href="/" aria-label="Back to Today"><span aria-hidden="true">‹</span> Today</a>');
	});
	it('addHidden marks the line for the add to step back', () => {
		expect(html({ addHidden: true })).toMatch(/<header [^>]*data-add-hidden=""/);
		expect(html({})).not.toContain('data-add-hidden');
	});
});

// The Log's Change the plan: the way in ends the hint line, and while it is on Done is the title line's one primary.
describe('TitleLine, a state entered from the hint line', () => {
	const plan = (pressed: boolean) => ({ label: 'Change the plan', pressed, onchange: () => {}, hint: 'Changing Push day A, from now on. Esc also leaves.', way: 'hint' as const });
	const html = (pressed: boolean) =>
		render(TitleLine, { props: { title: 'Gym', back: { href: '/', label: 'Today' }, more: [{ label: 'All open', checked: false }], hint: 'Push day A · Saved', state: plan(pressed) } }).body.replace(/<!--.*?-->/g, '');

	it('off: the way in ends the hint line, quiet; no pressed button, no Done, the ⋯ live', () => {
		const b = html(false);
		expect(b).not.toContain('aria-pressed');
		expect(b).not.toContain('>Done<');
		expect(b).toMatch(/<div class="title-actions">[^]*More on Gym/);
		expect(b).toMatch(/<span data-hint="use">Push day A · Saved<span class="hint-tools"><button type="button" class="quiet">Change the plan<\/button><\/span><\/span>/);
	});
	it('on: the line pins with Done alone in the actions, the one primary, and the hint says what changes', () => {
		const b = html(true);
		expect(b).toMatch(/<header class="titlebar[^"]*" data-mode="state"/);
		const id = b.match(/<span data-hint="state" id="([^"]+)">/)?.[1];
		expect(id).toBeTruthy();
		// Done says what changes: it is described by the state's hint.
		expect(b).toContain(`<div class="title-actions" data-done=""><button type="button" class="primary" aria-describedby="${id}">Done</button></div>`);
		expect(b).toMatch(/Done<\/button><\/div>\s*<\/header>/);
		expect(b).not.toContain('More on Gym');
		expect(b.match(/primary/g)).toHaveLength(1);
		expect(b).toMatch(/<span data-hint="use" inert[^>]*>Push day A · Saved<span class="hint-tools">/);
		expect(b).toMatch(/<span data-hint="state" id="[^"]+">Changing Push day A, from now on\. Esc also leaves\.<\/span>/);
	});
});

// Until the last screen moves, a page that moved to TitleLine must read exactly as it did on EditChrome in Use.
describe('TitleLine in Use is EditChrome in Use', () => {
	// Whitespace that draws nothing is left out: between the flex line's and the grid hint line's items, and at the
	// start of a hint (a grid item, so a leading space collapses).
	const loose = render as (c: unknown, o: { props: Record<string, unknown> }) => { body: string }; // two components, one set of props
	const bare = (c: unknown, props: Record<string, unknown>) =>
		loose(c, { props })
			.body.replace(/<!--.*?-->/g, '')
			.replace(/>\s+</g, '><')
			.replace(/(data-hint="\w+"[^>]*>)\s+/g, '$1')
			.trim();
	const day = createRawSnippet(() => ({ render: () => '<span class="day-line">1 May · yesterday</span>' }));
	const back = createRawSnippet(() => ({ render: () => '<a class="button" href="/">Back to today</a>' }));
	const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
		['back and a hint', { title: 'Gallery', back: { href: '/habits', label: 'Habits' }, hint: 'Ready-made habits.' }, { hints: { use: 'Ready-made habits.' } }],
		['an empty hint keeps the line', { title: 'Plank', back: { href: '/gallery', label: 'Gallery' }, hint: '' }, { hints: { use: '' } }],
		['no hint, no line', { title: 'Edit collection', back: { href: '/library', label: 'Library' } }, {}],
		['the ⋯', { title: 'Push day', hint: 'Today', more: [{ label: 'Skip today', onselect: () => {} }] }, { hints: { use: 'Today' } }],
		['an add', { title: 'Habits', add: { label: 'New habit', href: '/habits/new' }, addHidden: true }, {}],
		['a hint and actions as snippets', { title: 'Thursday', hint: day, actions: back }, { useHint: day, actions: back }]
	];
	it.each(cases)('%s', (_, props, was) => {
		const { hint: _h, ...rest } = props;
		expect(bare(TitleLine, props)).toBe(bare(EditChrome, { ...rest, modes: ['use'], ...was }));
	});
});
