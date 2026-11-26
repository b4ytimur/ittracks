import { describe, expect, it } from 'vitest';
import { backLabel } from './back';

describe('backLabel', () => {
	it('names the tab or the day it goes back to', () => {
		expect(backLabel('/')).toBe('Today');
		expect(backLabel('/history?notes')).toBe('History');
		expect(backLabel('/habits/abc')).toBe('Habits');
		expect(backLabel('/day/2026-11-25')).toBe(new Date('2026-11-25T12:00:00').toLocaleDateString(undefined, { weekday: 'long' }));
		expect(backLabel('/q/x')).toBe('Back');
	});
});
