// Today's rows: a habit's › always opens something (its Number); a group's or routine's shows only when opening it
// changes the row. In my order the grips never offer to put a habit inside another, so their hint doesn't either.
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { habitStats } from '$lib/engine/stats';
import { fromTemplate, viewState } from '$lib/views';
import Page from './+page.svelte';

const item = (id: string, name: string, more: Record<string, unknown> = {}) => ({
	habitId: id,
	name,
	occurrence: { id: `o-${id}`, status: 'due', variantName: null, slotCount: 0, level: null },
	streak: '',
	atRisk: false,
	earlyVariant: null,
	multiVariant: false,
	cue: { time: null, place: null, after: null, range: null },
	afterHabitId: null,
	upNext: false,
	levels: null,
	quickDone: false,
	identities: [],
	reframe: null,
	bundle: null,
	reward: null,
	progression: null,
	inProgress: false,
	canRepeat: false,
	areaId: null,
	pausedUntil: null,
	stats: habitStats([], '2026-11-27'),
	last: null,
	progress: null,
	parentId: null,
	group: null,
	...more
});
const routine = (more: Record<string, unknown> = {}) =>
	item('r1', 'Morning', { group: { routine: true, target: null, minimum: null, done: 0, total: 2, kids: [], undoable: false }, ...more });
const html = (today: Record<string, unknown>, build: ReturnType<typeof item>[]) =>
	(render as (c: unknown, o: { props: Record<string, unknown> }) => { body: string })(Page, {
		props: {
			data: {
				today: '2026-11-27',
				build,
				tracking: [],
				resting: [],
				paused: [],
				breaking: [],
				week: [],
				headlines: {},
				canBackfill: false,
				unlogged: [],
				finished: null,
				prep: [],
				askDay: false,
				packs: [],
				habitCount: build.length,
				hints: [],
				flash: null,
				views: { ...fromTemplate('standard'), defaults: { today: viewState.parse(today) } },
				ranges: [],
				areas: [],
				dayNote: null
			},
			form: null
		}
	}).body.replace(/<!--.*?-->/g, '');

describe("Today: a row's ›", () => {
	const read = item('h1', 'Read');
	it("a habit's always shows, even with every line", () => {
		expect(html({ rows: 'full' }, [read, routine()])).toContain('aria-label="More about Read"');
	});
	it("a routine's doesn't when opening it would change nothing: every line already, and no line to Hide or Show", () => {
		expect(html({ rows: 'full' }, [read, routine()])).not.toContain('More about Morning');
		expect(html({ rows: 'open' }, [read, routine()])).not.toContain('More about Morning');
	});
	it("a routine's shows when opening it lists a line with its Hide or Show", () => {
		expect(html({ rows: 'full' }, [read, routine({ reframe: 'I get to start fresh' })])).toContain('aria-label="More about Morning"');
	});
	it("a routine's shows when opening it says more: where it happens, under short rows", () => {
		const at = { cue: { time: null, place: 'Kitchen', after: null, range: null } };
		expect(html({ rows: 'short' }, [read, routine(at)])).toContain('aria-label="More about Morning"');
		expect(html({ rows: 'full' }, [read, routine(at)])).not.toContain('More about Morning');
	});
});

describe('Today in my order', () => {
	it("gives the grips a hint without a move inside the row above, which the list never makes", () => {
		const b = html({ sort: 'manual' }, [item('h1', 'Read'), item('h2', 'Walk')]);
		expect(b).toContain('aria-label="Move Read"');
		expect(b).toContain('Press to choose a move, drag, or use the up and down arrow keys.');
		expect(b).not.toContain('The right arrow');
	});
});
