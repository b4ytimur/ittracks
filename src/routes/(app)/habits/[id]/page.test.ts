// A habit's page has no Edit: the title line has no switch, its sections carry the grip whenever more than one shows,
// Reset section order is in the title line's ⋯ while the order isn't as it came, and On every new {kind} is a fold.
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { habitForm } from '$lib/forms';
import Editor from './Editor.svelte';

const V = '00000000-0000-4000-8000-000000000001';
const habit = (more: Record<string, unknown> = {}) =>
	habitForm.parse({
		name: 'Gym',
		direction: 'build',
		startDate: '2026-11-01',
		variants: [{ id: V, name: 'A', slots: [] }],
		schedule: { kind: 'weekly', days: { '1': V, '3': V, '5': V } },
		...more
	});
const data = (more: Record<string, unknown> = {}) => ({
	id: 'h1',
	isNew: false,
	mode: 'full',
	copiedFrom: null,
	habit: habit(),
	fixed: [],
	tasks: [],
	metrics: {},
	repeating: [],
	withParts: [],
	tags: [],
	habits: [],
	groups: [],
	inside: [],
	ownLogs: false,
	identities: [],
	areas: [],
	ranges: [],
	newLines: {},
	detail: {},
	hidden: [],
	pinned: false,
	archived: false,
	deleteAfter: null,
	pauses: [],
	today: '2026-11-27',
	directionLocked: false,
	usedFeelings: [],
	vapidKey: '',
	usedVariants: [],
	archivedVariants: [],
	hasLogs: false,
	types: [],
	...more
});
const html = (d: Record<string, unknown>) =>
	(render as (c: unknown, o: { props: Record<string, unknown> }) => { body: string })(Editor, { props: { data: data(d), form: null, onreset: () => {} } }).body.replace(/<!--.*?-->/g, '');
const grips = (b: string) => b.match(/aria-label="Move [^"]+"/g) ?? [];

describe("A habit's page", () => {
	it('has a title line with no switch and no second state', () => {
		const b = html({});
		expect(b).toContain('<h1 class="page-title">Gym</h1>');
		expect(b).not.toMatch(/role="radiogroup"|<button type="button" class="toggle" aria-pressed="(true|false)"><span data-reserve|data-hint="edit"/);
		expect(b).toMatch(/<header class="titlebar[^"]*" data-mode="use"/);
	});
	it('gives each section heading a grip when more than one section shows, naming the scope', () => {
		const b = html({ habit: habit({ reframe: 'I get to do this' }) }); // What you do, What keeps you at it, About
		expect(b).toContain('aria-label="Sections, in this order on every habit"');
		for (const s of ['What you do', 'What keeps you at it', 'About']) expect(grips(b)).toContain(`aria-label="Move ${s}"`);
	});
	it('has no grip on a lone section: a group with nothing on it shows only About', () => {
		const b = html({ habit: habit({ variants: [], schedule: { kind: 'group', target: null, minimum: null } }) });
		expect(b.match(/data-key="(what|counts|slip|keeps|about)"/g)).toEqual(['data-key="about"']);
		expect(grips(b)).toEqual([]);
		expect(b).toContain('</span>On every new group</summary>');
	});
	it('a new habit gets the grips too: the order is yours there as well', () => {
		expect(grips(html({ isNew: true, id: 'new' }))).toEqual(['aria-label="Move What you do"', 'aria-label="Move About"']);
	});
	it('offers Reset section order in the ⋯ only while the order of this kind is not as it came', () => {
		const reset = '<button type="button" role="menuitem" tabindex="-1"><span class="menu-label">Reset section order</span></button>';
		expect(html({})).not.toContain(reset);
		expect(html({ detail: { build: ['what', 'counts', 'slip', 'keeps', 'about'] } })).not.toContain(reset); // moved back by hand
		expect(html({ detail: { break: ['about'] } })).not.toContain(reset); // another kind's order
		const b = html({ detail: { build: ['about'] } });
		expect(b).toMatch(/Share as a template<\/span><\/a><button type="button" role="menuitem" tabindex="-1"><span class="menu-label">Reset section order<\/span><\/button><hr\/>/);
		expect(html({ isNew: true, id: 'new', detail: { build: ['about'] } })).toContain(reset); // a new habit's ⋯ holds only that
		expect(html({ isNew: true, id: 'new' })).not.toContain('More on New habit');
	});
	it('has On every new habit as a closed fold, in Use', () => {
		const b = html({});
		expect(b).toMatch(/<details class="disclosure new-lines[^"]*"><summary class="meta"><span class="chev" aria-hidden="true">›<\/span>On every new habit<\/summary>/);
		expect(b).toMatch(/<button type="button" class="toggle" aria-pressed="false">Levels<\/button>/);
		expect(html({ habit: habit({ direction: 'break', variants: [], schedule: null }) })).toContain('</span>On every new habit you break</summary>');
	});
});
