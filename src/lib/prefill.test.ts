// What Finish keeps of the values the log screen suggests (last time's, or the targets).
import { describe, expect, it } from 'vitest';
import { hasLog, isSuggestion, keepsSuggestions, onlySuggested, setByHand, type PlaceStart, type PlaceState } from './prefill';

const fresh = (prefill: Record<string, unknown>): PlaceStart => ({ prefill, saved: {}, savedAny: false });
const at = (summary: Record<string, unknown>, done = false): PlaceState => ({ sets: [{ done, values: {} }], summary });

describe('suggested values', () => {
	it('a value still at its suggestion is not a log; a changed one is', () => {
		const start = fresh({ time: 110 });
		expect(isSuggestion(at({ time: 110 }), start, 'time')).toBe(true);
		expect(hasLog(at({ time: 110 }), start)).toBe(false);
		expect(hasLog(at({ time: 108 }), start)).toBe(true);
		// A value saved before is a log, even when it equals last time's.
		expect(hasLog(at({ time: 110 }), { prefill: { time: 110 }, saved: { time: 110 }, savedAny: true })).toBe(true);
	});

	it('a session left half way: later rounds holding last time are asked about, and left out unless confirmed', () => {
		const starts = [fresh({ time: 112 }), fresh({ time: 110 }), fresh({ time: 108 })];
		const states = [at({ time: 105 }), at({ time: 110 }), at({ time: 108 })];
		expect(onlySuggested(states, starts)).toEqual([1, 2]);
		const keeps = (i: number, confirmed = false) => keepsSuggestions(states, starts, i, { finish: true, confirmed });
		expect([0, 1, 2].map((i) => keeps(i))).toEqual([true, false, false]);
		expect([0, 1, 2].map((i) => keeps(i, true))).toEqual([true, true, true]);
	});

	it('finished untouched keeps everything as planned; saving as you go keeps nothing suggested', () => {
		const starts = [fresh({ time: 112 }), fresh({ time: 110 })];
		const states = [at({ time: 112 }), at({ time: 110 })];
		expect(onlySuggested(states, starts)).toEqual([]);
		expect(keepsSuggestions(states, starts, 1, { finish: true, confirmed: false })).toBe(true);
		expect(keepsSuggestions(states, starts, 1, { finish: false, confirmed: true })).toBe(false);
	});

	it('a value typed by hand is logged, also when it is the suggested number', () => {
		const starts = [fresh({ time: 112 }), fresh({ time: 110 }), fresh({ time: 108 })];
		const states = [at({ time: 105 }), setByHand(at({ time: 110 }), 'time', 110), at({ time: 108 })];
		expect(isSuggestion(states[1], starts[1], 'time')).toBe(false);
		expect(hasLog(states[1], starts[1])).toBe(true);
		// Only the round nobody touched is asked about. Saving as you go sends a value unless it is a
		// suggestion it doesn't keep, so the typed one goes too.
		expect(onlySuggested(states, starts)).toEqual([2]);
		const sent = (i: number) => keepsSuggestions(states, starts, i, { finish: false, confirmed: false }) || !isSuggestion(states[i], starts[i], 'time');
		expect([0, 1, 2].map(sent)).toEqual([true, true, false]);
	});

	it('a place with nothing suggested (a finished log) has no suggestions', () => {
		expect(isSuggestion(at({ time: 110 }), fresh({}), 'time')).toBe(false);
		expect(hasLog(at({ time: 110 }), fresh({}))).toBe(true);
	});
});
