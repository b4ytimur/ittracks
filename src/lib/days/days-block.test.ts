// The days block as the server draws it: the first paint has the counts, the names read what is shown, and a page
// that draws the 12 months itself is never offered them twice.
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import DaysBlock from './DaysBlock.svelte';
import type { Count, Show } from './days';

const today = '2026-11-26';
const counts: Record<string, Count> = { '2026-11-23': [2, 2], '2026-11-24': [1, 2], '2026-11-25': [0, 2], [today]: [0, 2] };
const draw = (show: Show, more: Record<string, unknown> = {}) =>
	render(DaysBlock, { props: { today, first: '2026-01-05', counts, habits: [{ id: 'g', name: 'Gym' }], show, habit: null, href: (d: string) => `/day/${d}`, ...more } }).body;

describe('the days block', () => {
	it('has the counts before it hydrates', () => {
		const out = draw('week');
		expect(out).toContain('2 of 2 done');
		expect(out).toMatch(/data-day="done"/);
		expect(out).not.toContain('Nothing due');
	});
	it('is named by its title; the picker inside starts with the words it shows', () => {
		const out = draw('week');
		expect(out).toMatch(/<h2[^>]*aria-label="Week 48"/);
		expect(out).toContain('aria-label="Week 48, pick a week"');
		expect(out).toMatch(/<section class="days" aria-labelledby="[^"]+"/);
		expect(out).toContain('aria-label="More on days"');
	});
	it('says today on the cell that is read, never on its mark, and no tile repeats its name', () => {
		for (const show of ['week', 'month'] as const) {
			const out = draw(show);
			expect(out).toMatch(/class="(day-cell|days-tile)[^"]*"[^>]*aria-current="date"/);
			expect(out).not.toMatch(/<i[^>]*aria-current/);
			expect(out).not.toMatch(/\stitle="/);
		}
	});
	it('draws the 12 months as a picture, a column a week', () => {
		const out = draw('year');
		expect(out.match(/<span class="days-col[^"]*" role="img"/g)).toHaveLength(52);
		expect(out).not.toMatch(/<button[^>]*days-col/);
	});
	it('shows a week for the 12 months where the page draws them itself', () => {
		const out = draw('year', { twelve: false });
		expect(out).toMatch(/<h2[^>]*aria-label="Week 48"/);
		expect(out).not.toContain('Last 12 months');
	});
	it('names the one habit it counts', () => {
		expect(draw('week', { habit: 'g', counts: {} })).toMatch(/<p class="days-sub meta muted">Gym · /);
	});
	it('names seven days before today by their dates, short enough for a phone', () => {
		const out = draw('seven', { chosen: '2026-11-20' });
		expect(out).toMatch(/<h2[^>]*aria-label="Nov 14\s–\s20"/);
		expect(out).toMatch(/<p class="days-sub meta muted">Seven days</);
		expect(draw('seven')).toMatch(/<h2[^>]*aria-label="Last seven days"/);
	});
	it('has no way back on the day the page is on', () => {
		expect(draw('seven', { chosen: '2026-11-20' })).not.toContain('days-back');
		expect(draw('week', { chosen: '2026-11-10' })).toContain('days-back');
	});
});
