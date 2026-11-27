// ViewSentence: the view-name menu holds the view's housekeeping, in Use, the same on every page that has a sentence.
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ViewSentence from './ViewSentence.svelte';
import { libraryWords } from './view-words';
import { viewSettings, viewState, type ViewState } from './views';

const morning = { id: 'v1', name: 'Morning', page: 'library' as const, state: viewState.parse({ sort: 'name' }) };
const came = viewState.parse({});

/** The view-name menu's rows, in order: each label, and --- for a rule. */
function menu(p: { on?: string; current?: ViewState; reset?: ViewState }) {
	const current = p.current ?? came;
	const views = viewSettings.parse({ saved: [morning], active: p.on ? { library: p.on } : {}, open: { library: 'last' } });
	const body = render(ViewSentence, { props: { page: 'library', views, current, words: libraryWords(current, { areas: false }), reset: p.reset } }).body;
	const tail = body.slice(body.indexOf('aria-label="Views of Library"'));
	const rows = tail.slice(0, tail.indexOf('</div>')).match(/<hr|<span class="menu-label">[^<]*/g) ?? [];
	return rows.map((r) => (r === '<hr' ? '---' : r.replace('<span class="menu-label">', '')));
}

describe('the view-name menu', () => {
	it('on a view you made: the views, New view, then Rename view and Delete view, then what the page opens with', () => {
		expect(menu({ on: 'v1', current: morning.state })).toEqual(['Default', 'Morning', 'New view', '---', 'Rename view', 'Delete view', '---', 'Library opens with the view I was on last']);
	});
	it('on Default as it came: nothing of its own to do, so no Rename, Delete or Reset', () => {
		expect(menu({ reset: came })).toEqual(['Default', 'Morning', 'New view', '---', 'Library opens with the view I was on last']);
	});
	it('on Default changed from what it came as: Reset view, where the page offers one', () => {
		const changed = viewState.parse({ sort: 'name' });
		expect(menu({ current: changed, reset: came })).toEqual(['Default', 'Morning', 'New view', '---', 'Reset view', '---', 'Library opens with the view I was on last']);
		expect(menu({ current: changed })).not.toContain('Reset view');
	});
	it('a view you made never resets, however it differs', () => {
		expect(menu({ on: 'v1', current: viewState.parse({ sort: 'newest' }), reset: came })).not.toContain('Reset view');
	});
});
