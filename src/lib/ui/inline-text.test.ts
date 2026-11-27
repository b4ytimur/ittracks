// InlineText: the box opens on a tap while editing, or when the page sets `open` (Rename in a menu), in any mode.
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import InlineText from './InlineText.svelte';

const html = (props: Record<string, unknown>) => render(InlineText, { props: { value: 'Gym', onsave: () => {}, ...props } }).body;

describe('InlineText', () => {
	it('is plain text in use and a button while editing', () => {
		expect(html({})).not.toMatch(/<(input|button)/);
		expect(html({ editing: true })).toMatch(/<button[^>]*class="inline-text"/);
	});
	it('renders the box with the current text when the page opens it, also outside editing', () => {
		for (const editing of [false, true]) {
			const out = html({ open: true, editing, label: 'Rename Gym' });
			expect(out).toMatch(/<input[^>]*class="inline-text"/);
			expect(out).toMatch(/value="Gym"/);
			expect(out).toMatch(/aria-label="Rename Gym"/);
		}
	});
});
