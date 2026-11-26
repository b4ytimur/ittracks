import { describe, expect, it } from 'vitest';
import { sentence, todayWords, type TodayCtx } from './view-words';
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
});
