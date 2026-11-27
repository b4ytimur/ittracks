import { describe, expect, it } from 'vitest';
import { mergeOrder } from './ui/list';
import {
	TEMPLATES,
	fromTemplate,
	groupBy,
	initialState,
	initialView,
	keepsEmptyAreas,
	manualOrder,
	movedPart,
	sameSide,
	partAt,
	passes,
	readViews,
	sameState,
	sectionOrder,
	switchTemplate,
	ownChanges,
	recordDefault,
	recordPatch,
	viewSettings,
	viewState,
	STARTERS,
	emptyState,
	type LineKey,
	type ViewSettings,
	type ViewState
} from './views';
import { habitStats, headlineText } from './engine/stats';
import { templateFile } from './template';
import gym from './gallery/beginner-5x5.ittracks.json';

describe('views', () => {
	it('reads nothing as Standard, keeping the old Group by Area choice', () => {
		const v = readViews(undefined, { groupByArea: true });
		expect(v.template).toBe('standard');
		expect(v.defaults.today?.group).toBe('area');
		expect(v.defaults.library?.group).toBe('area');
		expect(v.defaults.history?.group).toBe('none');
		expect(v.today.done).toBe('keep');
		expect(v.hidden).toEqual([]);
	});

	it('every template parses and only names real sections', () => {
		for (const t of TEMPLATES) {
			const v = fromTemplate(t.id);
			expect(viewSettings.safeParse(v).success).toBe(true);
			expect(sectionOrder(v).map((s) => s.key).sort()).toEqual(['breaking', 'due', 'paused', 'prep', 'resting', 'tracking']);
		}
	});

	it('routine groups Today by part of day, in my order, time-aware', () => {
		const v = fromTemplate('routine');
		expect(v.defaults.today).toMatchObject({ group: 'part', sort: 'manual' });
		expect(v.today.timeAware).toBe(true);
	});

	it('switching template keeps saved views, own order and per-habit numbers', () => {
		const v = fromTemplate('standard');
		v.saved.push({ id: 's1', name: 'Gym days', page: 'today', state: viewState.parse({ areas: ['a1'] }) });
		v.today.order = ['h2', 'h1'];
		v.today.headlineFor = { h1: 'week' };
		v.startPage = 'library';
		const next = switchTemplate(v, 'minimal');
		expect(next.template).toBe('minimal');
		expect(next.saved).toHaveLength(1);
		expect(next.today.order).toEqual(['h2', 'h1']);
		expect(next.today.headlineFor).toEqual({ h1: 'week' });
		expect(next.startPage).toBe('library');
		expect(next.hidden).toContain('identities');
	});

	it('lists the settings changed on top of the template', () => {
		const v = fromTemplate('standard');
		expect(ownChanges(v)).toEqual([]);
		v.today.done = 'collapse';
		v.today.widgets = ['week'];
		v.hidden = ['cost'];
		v.defaults.today = { ...v.defaults.today!, group: 'area' };
		expect(ownChanges(v).map((c) => c.label)).toEqual(['Done items', 'Widgets on Today', 'Hidden features', 'Today grouping']);
	});

	it('switching template keeps your layout, page defaults and hidden features by default', () => {
		const v = fromTemplate('standard');
		v.today.done = 'collapse';
		v.today.widgets = ['week'];
		v.today.lines = v.today.lines.filter((l) => l !== 'reframe');
		v.today.sections = [
			{ key: 'breaking', show: true },
			{ key: 'due', show: true },
			{ key: 'prep', show: true },
			{ key: 'paused', show: true },
			{ key: 'resting', show: true }
		];
		v.hidden = ['cost'];
		v.defaults.today = { ...v.defaults.today!, group: 'area', areas: ['a1'] };
		v.open = { today: 'default' };
		const next = switchTemplate(v, 'gym');
		expect(next.template).toBe('gym');
		expect(next.today.done).toBe('collapse');
		expect(next.today.sections[0].key).toBe('breaking');
		// Gym adds progress and week; you had added week yourself.
		expect(next.today.widgets).toEqual(['progress', 'week']);
		// Gym shows four lines; you had taken reframe away, which Gym doesn't show anyway.
		expect(next.today.lines).toEqual(['cue', 'headline', 'levels', 'progression']);
		// Gym hides rewards and cost; you had hidden cost.
		expect(next.hidden.sort()).toEqual(['cost', 'rewards']);
		expect(next.defaults.today).toMatchObject({ group: 'area', areas: ['a1'] });
		// Gym's own default for the Library still applies, since you never changed it.
		expect(next.defaults.library?.sort).toBe('used');
		expect(next.open).toEqual({ today: 'default' });
		// Your changes are still yours on top of Gym.
		expect(ownChanges(next).map((c) => c.label)).toContain('Done items');
	});

	it('a feature you switched back on stays on after a switch', () => {
		const v = fromTemplate('minimal');
		v.hidden = v.hidden.filter((f) => f !== 'levels');
		const next = switchTemplate(v, 'quitter');
		expect(next.hidden).not.toContain('levels');
		expect(next.hidden).toContain('prep');
	});

	it('switching without keeping replaces your own changes, but never saved views or opens-with', () => {
		const v = fromTemplate('standard');
		v.today.done = 'collapse';
		v.defaults.today = { ...v.defaults.today!, group: 'area' };
		v.open = { today: 'default' };
		const next = switchTemplate(v, 'minimal', { keep: false });
		expect(next.today.done).toBe('collapse'); // Minimal folds done items itself
		expect(next.defaults.today?.group).toBe('none');
		expect(next.open).toEqual({ today: 'default' });
		const reset = switchTemplate({ ...v, today: { ...v.today, done: 'hide' } }, 'standard', { keep: false });
		expect(reset.today.done).toBe('keep');
		expect(ownChanges(reset)).toEqual([]);
	});

	it('switching away and back with your changes kept changes nothing of yours', () => {
		const v = fromTemplate('minimal');
		v.today.widgets = ['progress'];
		v.today.lines = ['cue'];
		v.today.done = 'keep';
		const back = switchTemplate(switchTemplate(v, 'standard'), 'minimal');
		expect(back.today.widgets).toEqual(['progress']);
		expect(back.today.lines).toEqual(['cue']);
		expect(back.today.done).toBe('keep');
	});

	it('remembers what you change by hand across switches, even when a template shares it', () => {
		// Ruth: on Minimal, turns on Progress today, the When and where line, and Done items stay where they are.
		let v = fromTemplate('minimal');
		v = { ...v, own: recordPatch(v, { today: { widgets: ['progress'] } }), today: { ...v.today, widgets: ['progress'] } };
		v = { ...v, own: recordPatch(v, { today: { lines: ['cue'] } }), today: { ...v.today, lines: ['cue'] } };
		v = { ...v, own: recordPatch(v, { today: { done: 'keep' } }), today: { ...v.today, done: 'keep' } };
		const back = switchTemplate(switchTemplate(v, 'standard'), 'minimal');
		expect(back.today.widgets).toEqual(['progress']);
		expect(back.today.lines).toEqual(['cue']);
		expect(back.today.done).toBe('keep');
		expect(ownChanges(back).map((c) => c.label)).toEqual(['Done items', 'Widgets on Today', 'Lines on each habit']);
	});

	it('a value set back to the template is no longer your own', () => {
		const v = fromTemplate('standard');
		const own = recordPatch({ ...v, today: { ...v.today, done: 'hide' }, own: { 'today.done': 'hide' } }, { today: { done: 'keep' } });
		expect(own).toEqual({});
		const off = recordPatch(v, { today: { widgets: ['week'] } });
		expect(off).toEqual({ 'today.widgets': { add: ['week'], remove: [] } });
		const on = recordPatch({ ...v, today: { ...v.today, widgets: ['week'] }, own: off }, { today: { widgets: [] } });
		expect(on).toEqual({});
	});

	it('a page default you set is yours, field by field', () => {
		const v = fromTemplate('routine');
		// Routine's own Today words (part of day, time-aware) stay; only the grouping is yours.
		const own = recordDefault(v, 'today', viewState.parse({ ...v.defaults.today, group: 'area' }));
		expect(own).toEqual({ 'defaults.today.group': 'area' });
		const next = switchTemplate({ ...v, own }, 'standard');
		expect(next.defaults.today).toMatchObject({ group: 'area', sort: 'cue' });
	});

	it('opens on the view it was on last, the page default, or a saved view', () => {
		const v = fromTemplate('standard');
		v.saved.push({ id: 's1', name: 'Quit', page: 'today', state: viewState.parse({ direction: 'break' }) });
		expect(initialView(v, 'today')).toBe('default');
		v.active.today = 's1';
		expect(initialView(v, 'today')).toBe('s1');
		expect(initialState(v, 'today').direction).toBe('break');
		v.open.today = 'default';
		expect(initialView(v, 'today')).toBe('default');
		expect(initialState(v, 'today')).toEqual(v.defaults.today);
		v.open.today = 's1';
		v.active.today = 'default';
		expect(initialState(v, 'today').direction).toBe('break');
	});

	it('is on one view even when two show the same thing', () => {
		const v = fromTemplate('standard');
		// A view made from Default before changing anything: same state, its own id.
		v.saved.push({ id: 's1', name: 'Morning', page: 'today', state: v.defaults.today! });
		v.active.today = 's1';
		expect(initialView(v, 'today')).toBe('s1');
		v.active.today = 'default';
		expect(initialView(v, 'today')).toBe('default');
	});

	it('finds the view for a page stored before it remembered one, from what was used last', () => {
		const v = fromTemplate('standard');
		v.saved.push({ id: 's1', name: 'By name', page: 'today', state: viewState.parse({ sort: 'name' }) });
		v.last.today = viewState.parse({ sort: 'name' });
		expect(initialView(v, 'today')).toBe('s1');
		v.last.today = viewState.parse({ sort: 'nothing saved' });
		expect(initialView(v, 'today')).toBe('default');
	});

	it("is never on another page's view, or one that was deleted", () => {
		const v = readViews({
			...fromTemplate('standard'),
			saved: [{ id: 'h1', name: 'Mine', page: 'habits', state: viewState.parse({}) }],
			active: { today: 'h1', library: 'gone', habits: 'h1' }
		});
		expect(v.active).toEqual({ habits: 'h1' });
		expect(initialView(v, 'today')).toBe('default');
		expect(initialView(v, 'habits')).toBe('h1');
	});

	it('opens with a copy, so changing it leaves the view as it was until saved', () => {
		const v = fromTemplate('standard');
		const s = initialState(v, 'today');
		s.areas.push('a');
		expect(v.defaults.today!.areas).toEqual([]);
	});

	it('keeps the view each page is on over a template switch', () => {
		const v = { ...fromTemplate('standard'), active: { today: 'default' } };
		expect(switchTemplate(v, 'minimal').active).toEqual({ today: 'default' });
	});

	it('drops an "opens with" that points at a deleted view', () => {
		const v = readViews({ ...fromTemplate('standard'), open: { today: 'gone' } });
		expect(v.open.today).toBeUndefined();
	});

	it('falls back to the template when stored views are broken', () => {
		expect(readViews({ template: 'gym', today: { done: 'nonsense' } }).template).toBe('gym');
	});

	it('filters by area, type and identity', () => {
		const s = viewState.parse({ areas: ['a'], direction: 'build', identity: 'Runner' });
		expect(passes(s, { areaId: 'a', direction: 'build', identities: ['Runner'] })).toBe(true);
		expect(passes(s, { areaId: 'b', direction: 'build', identities: ['Runner'] })).toBe(false);
		expect(passes(s, { areaId: 'a', direction: 'break', identities: ['Runner'] })).toBe(false);
		expect(passes(s, { areaId: 'a', direction: 'build', identities: [] })).toBe(false);
		expect(passes(viewState.parse({ areas: [''] }), { areaId: null })).toBe(true);
	});

	it('groups by part of day with untimed habits last', () => {
		const items = [
			{ id: 1, areaId: null, part: 'Evening' },
			{ id: 2, areaId: null, part: null },
			{ id: 3, areaId: null, part: 'Morning' }
		];
		const g = groupBy(items, 'part', { areas: [], parts: ['Morning', 'Evening'] });
		expect(g.map((x) => x.label)).toEqual(['Morning', 'Evening', 'Any time']);
	});

	it('puts items in my order, unknown ones after', () => {
		expect(manualOrder(['a', 'b', 'c', 'd'], ['c', 'a'], (x) => x)).toEqual(['c', 'a', 'b', 'd']);
	});

	it('a move in a list whose done rows sink puts back only its own side of the line', () => {
		// My order a b c; a is done, so Today shows b c a. Moving c above b leaves a first in the order.
		const done = new Set(['a']);
		expect(mergeOrder(['a', 'b', 'c'], movedPart(['c', 'b', 'a'], 'c', done))).toEqual(['a', 'c', 'b']);
		// Dropped under a done row, it goes as far down as the habits still to do reach.
		expect(mergeOrder(['a', 'b', 'c'], movedPart(['c', 'a', 'b'], 'b', done))).toEqual(['a', 'c', 'b']);
		// A done row moves among the done ones only.
		expect(mergeOrder(['a', 'b', 'c', 'd'], movedPart(['b', 'd', 'c', 'a'], 'c', new Set(['a', 'c'])))).toEqual(['c', 'b', 'a', 'd']);
	});
	it('nothing sunk: the whole list goes back', () => {
		expect(movedPart(['c', 'a', 'b'], 'c', new Set())).toEqual(['c', 'a', 'b']);
	});
	it('the grips offer no move across the done line, which would change nothing, and none inside', () => {
		// Today shows b c a, a done: c can't go below a, nor a above c; b and c still swap.
		const done = new Set(['a']);
		expect(sameSide(done, { key: 'c', target: 'a', position: 'after' })).toBe(false);
		expect(sameSide(done, { key: 'a', target: 'c', position: 'before' })).toBe(false);
		expect(sameSide(done, { key: 'b', target: 'c', position: 'after' })).toBe(true);
		expect(sameSide(new Set(['a', 'd']), { key: 'd', target: 'a', position: 'before' })).toBe(true);
		expect(sameSide(new Set(), { key: 'c', target: 'b', position: 'inside' })).toBe(false);
	});

	it('finds the part of day, including ranges past midnight', () => {
		const r = [
			{ name: 'Morning', start: '05:00', end: '11:00' },
			{ name: 'Night', start: '22:00', end: '02:00' }
		];
		expect(partAt(r, '07:30')).toBe('Morning');
		expect(partAt(r, '23:00')).toBe('Night');
		expect(partAt(r, '01:00')).toBe('Night');
		expect(partAt(r, '15:00')).toBeNull();
	});

	it('compares states with defaults filled in', () => {
		expect(sameState(viewState.parse({}), { ...viewState.parse({}), tags: [] })).toBe(true);
		expect(sameState(viewState.parse({}), viewState.parse({ sort: 'name' }))).toBe(false);
	});
});

describe('habit stats', () => {
	const today = '2026-11-21'; // a Saturday
	it('counts consistency over 30 days, ignoring skips and today while due', () => {
		const s = habitStats(
			[
				{ date: '2026-11-10', status: 'done' },
				{ date: '2026-11-12', status: 'missed' },
				{ date: '2026-11-14', status: 'skipped' },
				{ date: '2026-11-17', status: 'done' },
				{ date: '2026-11-21', status: 'due' },
				{ date: '2026-09-01', status: 'done' }
			],
			today
		);
		expect(s.consistency).toBe(67);
		expect(s.week).toBe(1);
		expect(s.total).toBe(3);
		expect(s.lastDone).toBe('2026-11-17');
		// Its first day in the window is Nov 10: 12 days, not 30.
		expect(headlineText('consistency', s, '')).toBe('67% in 12 days');
	});
	it('a group made yesterday never claims a month', () => {
		const s = habitStats([{ date: '2026-11-20', status: 'done' }, { date: '2026-11-21', status: 'done' }], today);
		expect(headlineText('consistency', s, '')).toBe('100% in 2 days');
		expect(headlineText('consistency', habitStats([{ date: '2026-11-21', status: 'done' }], today), '')).toBe('100% in 1 day');
	});
	it('says nothing with nothing scheduled', () => {
		expect(habitStats([], today).consistency).toBeNull();
		expect(headlineText('consistency', habitStats([], today), '')).toBe('');
		expect(headlineText('week', habitStats([], today), '')).toBe('0 done this week');
		expect(headlineText('streak', habitStats([], today), '3 days')).toBe('3 days');
	});
});

describe('template view hint (format v4)', () => {
	it('reads the suggested view, and older files have none', () => {
		const t = templateFile.parse(gym);
		expect(t.view).toBe('gym');
		expect(templateFile.parse({ ...gym, version: 3, view: undefined }).view).toBeNull();
	});
});

describe('view rules', async () => {
	const { checkViews } = await import('./rules/views');
	it('templates break no rules', () => {
		for (const t of TEMPLATES) expect(checkViews(fromTemplate(t.id), { ranges: 4 }).filter((i) => i.severity === 'block')).toEqual([]);
	});
	it('blocks opening with another page\'s saved view', () => {
		const v = fromTemplate('standard');
		v.saved.push({ id: 's1', name: 'Lib', page: 'library', state: viewState.parse({}) });
		v.open.today = 's1';
		expect(checkViews(v, { ranges: 0 }).map((i) => i.severity)).toContain('block');
	});
	it('warns when a hidden feature is still used by a view or section', () => {
		const v = fromTemplate('standard');
		v.hidden = ['identities', 'prep'];
		v.defaults.today = viewState.parse({ group: 'identity' });
		const r = checkViews(v, { ranges: 0 });
		expect(r.filter((i) => i.severity === 'warn').map((i) => i.path).sort()).toEqual(['hidden', 'today.sections']);
	});
	it('warns about the time-aware view without parts of the day', () => {
		expect(checkViews(fromTemplate('routine'), { ranges: 0 }).map((i) => i.path)).toContain('today.timeAware');
	});
});

describe("Today's words (TS.2)", () => {
	/** Stored views from before each Today view kept its own words: no rows, maybe a layout. */
	const before = (tpl: string, change: (v: ViewSettings) => void = () => {}) => {
		const v = JSON.parse(JSON.stringify(fromTemplate(tpl))) as ViewSettings & { own?: unknown };
		delete v.own;
		for (const k of ['rows', 'num', 'done', 'first', 'hide', 'fits']) delete (v.defaults.today as Record<string, unknown>)[k];
		change(v);
		return v;
	};
	it('a new view says the short sentence, and two views with other words differ', () => {
		expect(viewState.parse({})).toMatchObject({ rows: 'short', num: 'streak', done: 'bottom', first: false, hide: [], fits: false });
		expect(sameState(viewState.parse({}), viewState.parse({ rows: 'open' }))).toBe(false);
	});
	it("each template's Today words are a starting sentence", () => {
		const s = Object.fromEntries(STARTERS().map((x) => [x.id, x.state]));
		expect(s.routine).toMatchObject({ group: 'part', sort: 'manual', fits: true });
		expect(s.minimal).toMatchObject({ rows: 'names', num: 'none', done: 'collapse' });
		expect(s.quitter.first).toBe(true);
		expect(s.standard).toMatchObject({ rows: 'short', num: 'streak', done: 'bottom' });
	});
	it('an old view keeps what you changed by hand, and takes the new words for the rest', () => {
		const v = readViews(before('standard', (x) => {
			x.today.done = 'collapse';
			x.today.headline = 'week';
		}));
		expect(v.defaults.today).toMatchObject({ done: 'collapse', num: 'week', rows: 'short', fits: false });
	});
	it('lines you turned off become a rows word and hidden lines', () => {
		const only = (lines: LineKey[]) => readViews(before('standard', (x) => (x.today.lines = lines))).defaults.today;
		expect(only(['cue', 'headline', 'levels'])).toMatchObject({ rows: 'open', hide: ['bundle'], num: 'streak' });
		expect(only(['cue', 'reframe'])).toMatchObject({ rows: 'full', num: 'none' });
		expect(only([])).toMatchObject({ rows: 'short', num: 'none', hide: [] });
	});
	it('the part-of-day tick and Breaking first come along', () => {
		const v = readViews(before('routine', (x) => {
			x.today.timeAware = false;
			x.today.sections = [{ key: 'breaking', show: true }, { key: 'due', show: true }];
		}));
		expect(v.defaults.today).toMatchObject({ fits: false, first: true });
	});
	it('a saved Today view migrates too, and its old layout says how it was grouped', () => {
		const v = before('standard', (x) => {
			(x.defaults.today as Record<string, unknown>).layout = 'blocks';
			x.saved = [{ id: 's1', name: 'Mine', page: 'today', state: { ...emptyState(), layout: 'flat', group: 'area' } as unknown as ViewState }];
			for (const k of ['rows', 'num', 'done', 'first', 'hide', 'fits']) delete (x.saved[0].state as Record<string, unknown>)[k];
		});
		const r = readViews(v);
		expect(r.defaults.today.group).toBe('area');
		expect(r.saved[0].state).toMatchObject({ group: 'none', rows: 'short', done: 'bottom' });
	});
	it('a view saved after this keeps its words as they are', () => {
		const v = fromTemplate('standard');
		v.defaults.today = { ...v.defaults.today, rows: 'full', done: 'hide' };
		expect(readViews(JSON.parse(JSON.stringify(v))).defaults.today).toMatchObject({ rows: 'full', done: 'hide' });
	});
});

it('folded headings: the defaults for old views, kept over a template switch', () => {
	const old = JSON.parse(JSON.stringify(fromTemplate('standard')));
	delete old.today.folded;
	const v = readViews(old);
	expect(v.today.folded).toEqual(['done', 'focus:later', 'blocks:later']);
	expect(switchTemplate({ ...v, today: { ...v.today, folded: ['area:x'] } }, 'focus', { keep: false }).today.folded).toEqual(['area:x']);
});

describe('empty Areas (MO: Areas are kept where they stand)', () => {
	it('show while grouped by Area with nothing narrowing the list', () => {
		expect(keepsEmptyAreas(viewState.parse({ group: 'area' }))).toBe(true);
		expect(keepsEmptyAreas(viewState.parse({ group: 'area', sort: 'name', archived: true }))).toBe(true);
	});
	it('a filter or a search hides them: an empty Area matches nothing', () => {
		for (const f of [{ areas: ['a1'] }, { direction: 'build' }, { identity: 'I read' }, { query: 'run' }, { tags: ['Legs'] }, { collection: 'c1' }])
			expect(keepsEmptyAreas(viewState.parse({ group: 'area', ...f })), JSON.stringify(f)).toBe(false);
	});
	it('not grouped by Area, there are no Area headings to keep', () => {
		for (const group of ['none', 'identity', 'direction', 'part']) expect(keepsEmptyAreas(viewState.parse({ group })), group).toBe(false);
	});
});
