import { describe, expect, it } from 'vitest';
import { barSays, openingButton, takesAnswer } from './catalog';

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

describe('barSays: the bar’s status line', () => {
	const base = { error: '', applying: false, filled: true, preview: null, left: 0 };
	it('says Applying… while an apply is away, even after a newer preview came back or was dropped', () => {
		expect(barSays({ ...base, applying: true })).toBe('Applying…');
		expect(barSays({ ...base, applying: true, preview: { count: 3, notes: [] } })).toBe('Applying…');
	});
	it('checks while a preview is away, or asks for what the form still needs', () => {
		expect(barSays(base)).toBe('Checking…');
		expect(barSays({ ...base, filled: false })).toBe('Fill in what it needs to see what changes.');
	});
	it('says what the preview found, with what stays and its notes', () => {
		expect(barSays({ ...base, preview: { count: 1, notes: [] } })).toBe('1 changes.');
		expect(barSays({ ...base, preview: { count: 3, notes: ['Days after today are left out.'] }, left: 1 })).toBe('3 change, 1 stays. Days after today are left out.');
		expect(barSays({ ...base, preview: { count: 0, notes: [] } })).toBe('Nothing would change.');
	});
	it('puts an error first', () => {
		expect(barSays({ ...base, applying: true, error: 'Couldn’t reach the server.' })).toBe('Couldn’t reach the server.');
	});
});
