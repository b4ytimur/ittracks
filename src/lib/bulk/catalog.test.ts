import { describe, expect, it } from 'vitest';
import { openingButton } from './catalog';

describe('openingButton: the action the bar opens on', () => {
	it("History's days have one action, Skip, so the bar opens on it", () => {
		expect(openingButton('day')).toMatchObject({ id: 'skip', label: 'Skip', action: 'skip' });
	});
	it('habits and Tasks have several, so the bar waits for a pick', () => {
		expect(openingButton('habit')).toBeNull();
		expect(openingButton('task')).toBeNull();
	});
});
