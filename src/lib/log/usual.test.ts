import { describe, expect, it } from 'vitest';
import { usualWay } from './usual';

describe('the usual way to log a habit with Tasks', () => {
	it('One-tap Done wins over Same as last', () => {
		expect(usualWay({ quickDone: true, canRepeat: true })).toBe('done');
		expect(usualWay({ quickDone: false, canRepeat: true })).toBe('same');
	});

	it('a started log resumes; nothing to repeat opens the log', () => {
		expect(usualWay({ inProgress: true, quickDone: true, canRepeat: true })).toBe('resume');
		expect(usualWay({ quickDone: false, canRepeat: false })).toBe('log');
	});
});
