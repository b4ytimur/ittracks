import { describe, expect, it } from 'vitest';
import { openingButton, takesAnswer } from './catalog';

describe('openingButton: the action the bar opens on', () => {
	it("History's days have one action, Skip, so the bar opens on it", () => {
		expect(openingButton('day')).toMatchObject({ id: 'skip', label: 'Skip', action: 'skip' });
	});
	it('habits and Tasks have several, so the bar waits for a pick', () => {
		expect(openingButton('habit')).toBeNull();
		expect(openingButton('task')).toBeNull();
	});
});

describe('takesAnswer: what the bar does with an answer when ticks changed while it was away', () => {
	it('drops a preview something newer was asked after', () => {
		expect(takesAnswer(false, 1, 2)).toBe(false);
		expect(takesAnswer(false, 2, 2)).toBe(true);
	});
	it("always takes an apply's, so the bar closes, the rows refresh and its Undo shows", () => {
		expect(takesAnswer(true, 1, 3)).toBe(true);
	});
});
