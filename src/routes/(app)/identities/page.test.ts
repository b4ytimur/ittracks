// Identities has no mode: the list is always arranged, so every row has its grip, its sentence as a box to tap and
// its Delete, and the slot at the end adds one.
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

const row = (id: string, statement: string, habits: { id: string; name: string }[] = []) => ({ id, statement, sortOrder: 0, week: 0, total: 0, habits });
const html = (identities: ReturnType<typeof row>[]) =>
	(render as (c: unknown, o: { props: Record<string, unknown> }) => { body: string })(Page, { props: { data: { identities } } }).body.replace(/<!--.*?-->/g, '');

describe('Identities', () => {
	const b = html([row('a', 'I am a runner', [{ id: 'h1', name: 'Run' }]), row('b', 'I am someone who reads')]);

	it('has a title line with no mode switch and no second state', () => {
		expect(b).toContain('<h1 class="page-title">Identities</h1>');
		expect(b).toContain('Who do you want to be? Press a sentence to change it.');
		expect(b).not.toMatch(/role="radiogroup"|aria-pressed|data-hint="edit"/);
		expect(b).toMatch(/<header class="titlebar[^"]*" data-mode="use"/);
	});
	it('gives every row its grip, its sentence to tap and its Delete', () => {
		for (const s of ['I am a runner', 'I am someone who reads']) {
			expect(b).toContain(`aria-label="Move ${s}"`);
			expect(b).toMatch(new RegExp(`<button type="button" class="inline-text" [^>]*><span>${s}</span></button>`));
			expect(b).toContain(`aria-label="Delete ${s}"`);
		}
		expect(b).toMatch(/<ul [^>]*class="elist[^"]*grips/);
	});
	it('ends with the slot that adds one', () => {
		expect(b).toMatch(/<button type="button" class="ghost-slot">[^]*?<span>New identity<\/span><\/button>/);
	});
	it('with none yet, says how to write one, above the slot', () => {
		const e = html([]);
		expect(e).toContain('None yet. Write one as a sentence');
		expect(e).toContain('<span>New identity</span>');
		expect(e).not.toContain('class="handle"');
	});
});
