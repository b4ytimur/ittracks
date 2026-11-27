import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TitleLine, { next, refocus } from './TitleLine.svelte';

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

describe('refocus: where focus goes once the state changed', () => {
	it('leaving Select with focus in what it hid (the bulk bar) puts it on the toggle; focus anywhere else stays', () => {
		expect(refocus(false, false, true)).toBe('toggle');
		expect(refocus(false, false, false)).toBeNull();
		expect(refocus(true, false, true)).toBeNull();
	});
	it('a state entered from the hint line moves focus between its way in and Done', () => {
		expect(refocus(true, true, false)).toBe('done');
		expect(refocus(false, true, true)).toBe('wayIn');
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

	it('off: the way in ends the hint line, quiet; no pressed button, Done inert in the ⋯\'s cell, the ⋯ live', () => {
		const b = html(false);
		expect(b).not.toContain('aria-pressed');
		expect(b).toMatch(/<div class="title-swap"><div class="title-actions">[^]*More on Gym[^]*?<\/div>\s*<div class="title-actions" data-done="" inert=""><button[^>]*>Done<\/button><\/div><\/div>/);
		expect(b).toMatch(/<span data-hint="use">Push day A · Saved<span class="hint-tools"><button type="button" class="quiet">Change the plan<\/button><\/span><\/span>/);
	});
	it('on: the line pins with Done live in the actions\' place, the one primary, and the hint says what changes', () => {
		const b = html(true);
		expect(b).toMatch(/<header class="titlebar[^"]*" data-mode="state"/);
		const id = b.match(/<span data-hint="state" id="([^"]+)">/)?.[1];
		expect(id).toBeTruthy();
		// Done says what changes: it is described by the state's hint.
		expect(b).toContain(`<div class="title-actions" data-done=""><button type="button" class="primary" aria-describedby="${id}">Done</button></div>`);
		// The ⋯ keeps its cell beside Done, inert, so the line keeps one width in both states and never rewraps.
		expect(b).toMatch(/<div class="title-swap"><div class="title-actions" inert="">[^]*More on Gym[^]*Done<\/button><\/div><\/div>\s*<\/header>/);
		expect(b.match(/primary/g)).toHaveLength(1);
		expect(b).toMatch(/<span data-hint="use" inert[^>]*>Push day A · Saved<span class="hint-tools">/);
		expect(b).toMatch(/<span data-hint="state" id="[^"]+">Changing Push day A, from now on\. Esc also leaves\.<\/span>/);
	});
	it('a Log with no ⋯ still keeps Done\'s room while off, so turning it on moves nothing', () => {
		const b = render(TitleLine, { props: { title: 'Gym', back: { href: '/', label: 'Today' }, hint: 'Saved', state: plan(false) } }).body.replace(/<!--.*?-->/g, '');
		expect(b).toMatch(/<div class="title-swap">\s*<div class="title-actions" data-done="" inert=""><button[^>]*>Done<\/button><\/div><\/div>/);
	});
});
