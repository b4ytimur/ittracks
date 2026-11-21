import { describe, expect, it } from 'vitest';
import {
	TEMPLATES,
	fromTemplate,
	groupBy,
	initialState,
	manualOrder,
	partAt,
	passes,
	readViews,
	sameState,
	sectionOrder,
	switchTemplate,
	viewSettings,
	viewState
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
			expect(sectionOrder(v).map((s) => s.key).sort()).toEqual(['breaking', 'due', 'paused', 'prep', 'resting']);
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

	it('opens with last, the page default, or a saved view', () => {
		const v = fromTemplate('standard');
		const last = viewState.parse({ sort: 'name' });
		v.last.today = last;
		expect(initialState(v, 'today')).toEqual(last);
		v.open.today = 'default';
		expect(initialState(v, 'today')).toEqual(v.defaults.today);
		v.saved.push({ id: 's1', name: 'Quit', page: 'today', state: viewState.parse({ direction: 'break' }) });
		v.open.today = 's1';
		expect(initialState(v, 'today').direction).toBe('break');
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
