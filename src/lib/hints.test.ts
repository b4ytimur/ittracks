import { expect, it } from 'vitest';
import { hintNow, HINTS } from './hints';

it('shows a hint until it is retired, then never again', () => {
	expect(hintNow([], ['done'])).toBe('done');
	expect(hintNow(['done'], ['done'])).toBeNull();
	expect(hintNow([], [])).toBeNull();
	expect(Object.values(HINTS).every((x) => x.length < 140)).toBe(true);
	// Undo stands on the logged row, never in the ⋯ (LogControl's ways have none).
	expect(HINTS.done).not.toMatch(/⋯[^.]*undo/i);
});
