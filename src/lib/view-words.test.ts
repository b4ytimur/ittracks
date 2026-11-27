import { describe, expect, it } from 'vitest';
import { habitsInMyOrder, habitsWords, historyWords, inMyOrder, libraryWords, ownNumber, sentence, todayWords, type TodayCtx } from './view-words';
import { viewState } from './views';

const ctx: TodayCtx = { areas: [{ id: 'a1', name: 'Fitness' }, { id: 'a2', name: 'Focus' }], identities: ['I am a non-smoker.'], parts: true, breaking: true };
const words = (o: object, c = ctx) => todayWords(viewState.parse(o), c);
const word = (o: object, key: string, c = ctx) => words(o, c).find((w) => w.key === key)!;

describe("Today's sentence (TS.1)", () => {
	it('reads the new view as the short sentence', () => {
		expect(sentence(words({}))).toBe('everything, by time, short rows with streaks, done at the end.');
	});
	it('names only drops the number, and every word reads back', () => {
		expect(sentence(words({ rows: 'names', done: 'collapse', group: 'part', fits: true }))).toBe('what fits now, by part of day, names only, done folded.');
		expect(sentence(words({ rows: 'open', num: 'none', sort: 'manual', direction: 'break', first: true }))).toBe('only breaking, in my order, breaking first, open rows without a number, done at the end.');
	});
	it('a pick gives the next state, and keeps what it does not name', () => {
		const what = word({ areas: ['a1'] }, 'what');
		expect(what.shown).toBe('everything in Fitness');
		expect(what.pick('scope:now')).toMatchObject({ fits: true, areas: ['a1'] });
		expect(what.pick('area:')).toMatchObject({ areas: [] });
		expect(word({}, 'by').pick('part')).toMatchObject({ group: 'part' });
		expect(word({ group: 'area' }, 'by').pick('mine')).toMatchObject({ group: 'none', sort: 'manual' });
	});
	it('two Areas from an older view still read, as the word they are now', () => {
		const what = word({ areas: ['a1', 'a2'], status: 'due' }, 'what');
		expect(what.value).toBe('_');
		expect(what.options[0].label).toBe('what is still to do in Fitness and Focus');
	});
	it('says only what can be: no parts of the day, no Areas, nothing to break', () => {
		const bare = { areas: [], identities: [], parts: false, breaking: false };
		expect(word({}, 'what', bare).options.map((o) => o.value)).toEqual(['scope:all', 'scope:todo']);
		expect(word({}, 'by', bare).options.map((o) => o.value)).toEqual(['time', 'mine', 'name', 'risk']);
		// A view that already says it keeps its word, so the select shows the truth.
		expect(word({ group: 'part' }, 'by', bare).options.map((o) => o.value)).toContain('part');
	});
	it('every option says what the band will say and what a kept view is called', () => {
		for (const w of words({ areas: ['a1'], identity: 'I am a non-smoker.' }))
			for (const o of w.options) {
				expect(o.said, `${w.key} ${o.value}`).toMatch(/^(now|is) /);
				expect(o.name.length).toBeGreaterThan(0);
			}
	});
	it('where Breaking stands is the last item of "by": its words flip, it never ticks, and a pick flips it back', () => {
		const after = word({}, 'by');
		expect(after.options.at(-1)).toMatchObject({ value: 'breaking:first', label: 'breaking first', said: 'now puts breaking first' });
		expect(after.pick('breaking:first')).toEqual({ ...viewState.parse({}), first: true });
		const first = word({ first: true }, 'by');
		expect(first.options.at(-1)).toMatchObject({ value: 'breaking:first', label: 'breaking after the day', said: 'now puts breaking after the day' });
		expect(first.pick('breaking:first')).toMatchObject({ first: false });
		expect(first.value).not.toBe('breaking:first');
		// An arrangement keeps where Breaking stands.
		expect(first.pick('name')).toMatchObject({ first: true, sort: 'name' });
	});
	it('nothing to break, no Breaking item', () => {
		expect(word({}, 'by', { ...ctx, breaking: false }).options.map((o) => o.value)).not.toContain('breaking:first');
	});
});

describe('grips on Today: while the sentence reads "in my order" (MO)', () => {
	it('My order with no groups reads "in my order", and has grips', () => {
		expect(inMyOrder(viewState.parse({ sort: 'manual' }))).toBe(true);
		expect(word({ sort: 'manual' }, 'by').shown).toMatch(/^in my order/);
	});
	it('any other sort has none', () => {
		for (const sort of ['cue', 'name', 'streak']) expect(inMyOrder(viewState.parse({ sort })), sort).toBe(false);
	});
	it('grouped, the sentence reads the grouping, so there are none even in My order', () => {
		for (const group of ['area', 'part', 'identity']) expect(inMyOrder(viewState.parse({ sort: 'manual', group })), group).toBe(false);
	});
});

describe('grips on Habits: while its sort word reads "in my order" (MO)', () => {
	const sortWord = (sort: string, group = 'none') => habitsWords(viewState.parse({ sort, group }), { areas: [{ id: 'a1', name: 'Fitness' }], identities: [], lines: [], setLines: () => {} }).find((w) => w.key === 'sort')!;
	const shown = (w: ReturnType<typeof sortWord>) => w.options.find((o) => o.value === w.value)!.label;
	it('My order has grips, grouped or not: the order word is its own', () => {
		for (const group of ['none', 'area', 'direction', 'identity']) {
			expect(habitsInMyOrder(viewState.parse({ sort: 'manual', group })), group).toBe(true);
			expect(shown(sortWord('manual', group))).toBe('in my order');
		}
	});
	it('a sort the page has no word for reads "in my order", so it has grips too', () => {
		expect(habitsInMyOrder(viewState.parse({ sort: 'cue' }))).toBe(true);
		expect(shown(sortWord('cue'))).toBe('in my order');
	});
	it('by name, by consistency and newest first have none', () => {
		for (const sort of ['name', 'consistency', 'created']) expect(habitsInMyOrder(viewState.parse({ sort })), sort).toBe(false);
	});
});

describe("a habit's own number, from its open row", () => {
	const all = { h1: 'streak' as const };
	it('sets one, says it, and leaves the map it came from alone', () => {
		expect(ownNumber(all, 'h2', 'Gym', 'week')).toEqual({ next: { h1: 'streak', h2: 'week' }, said: 'Gym now shows done this week.' });
		expect(all).toEqual({ h1: 'streak' });
	});
	it("'' follows the view again", () => {
		expect(ownNumber(all, 'h1', 'Read', '')).toEqual({ next: {}, said: "Read now shows the view's number." });
	});
	it('Nothing says no number', () => {
		expect(ownNumber(all, 'h1', 'Read', 'none')).toEqual({ next: { h1: 'none' }, said: 'Read now shows no number.' });
	});
});

describe('the same sentence on the other pages (TS.12)', () => {
	const areas = [{ id: 'a1', name: 'Fitness' }];
	it('Habits reads its view, and its lines are kept for the account', () => {
		const said: string[] = [];
		const w = habitsWords(viewState.parse({ group: 'area', sort: 'manual' }), { areas, identities: [], lines: ['schedule', 'cue'], setLines: (_, t) => said.push(t) });
		expect(sentence(w)).toBe('every habit, by Area in my order, with schedule and time.');
		const lines = w.find((x) => x.key === 'lines')!;
		lines.set!(lines.options.find((o) => o.label === 'with every line')!.value);
		expect(said).toEqual(['Each habit now shows every line.']);
		expect(sentence(habitsWords(viewState.parse({ direction: 'break', areas: ['a1'], archived: true, group: 'none', sort: 'name' }), { areas, identities: [], lines: ['last'], setLines: () => {} }))).toBe(
			'the habits to break in Fitness and the archived, in one list by name, with last done.'
		);
	});
	it('Library and History read theirs', () => {
		expect(sentence(libraryWords(viewState.parse({ group: 'area', sort: 'name' }), { areas: true }))).toBe('every Task, by Area, by name.');
		const h = historyWords(viewState.parse({ sort: 'newest', status: 'slip', habit: 'h1' }), { areas, habits: [{ id: 'h1', name: 'Less coffee' }], values: false, setValues: () => {} });
		expect(sentence(h)).toBe('only slips for Less coffee, newest first, without values.');
		expect(h[0].pick('more:h:')).toMatchObject({ habit: null, status: 'slip' });
	});
});
