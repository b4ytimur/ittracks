// GroupHeading: with a grip in it, the heading is named by its title alone (never "Move X X").
import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import GroupHeading from './GroupHeading.svelte';

const grip = createRawSnippet(() => ({ render: () => '<button type="button" class="handle" aria-label="Move About">⠿</button>' }));

describe('GroupHeading', () => {
	it('names itself by its title when it holds a grip', () => {
		const out = render(GroupHeading, { props: { title: 'About', grip } }).body;
		const id = out.match(/<span class="title" id="([^"]+)"/)?.[1];
		expect(id).toBeTruthy();
		expect(out).toMatch(new RegExp(`<h2[^>]*aria-labelledby="${id}"`));
	});
	it('keeps its content name without a grip', () => {
		expect(render(GroupHeading, { props: { title: 'About' } }).body).not.toMatch(/<h2[^>]*aria-labelledby/);
	});
});
