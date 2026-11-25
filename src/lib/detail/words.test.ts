import { describe, expect, it } from 'vitest';
import { celebrateWords, costWords, cueWords, insteadWords, jarWords, levelWords, limitWords, noteWords, raiseWords, streakWords, treatWords } from './words';
import { defaultLevels, emptyCue } from '$lib/forms';

describe('what a line of a habit says', () => {
	it('when and where', () => {
		expect(cueWords({ ...emptyCue(), afterText: 'work', time: '18:15', place: 'the gym' }, true)).toBe('After work, at 18:15, at the gym. Reminds you.');
		expect(cueWords({ ...emptyCue(), range: 'Morning', place: 'in the park' }, false)).toBe('In the morning, in the park.');
		expect(cueWords({ ...emptyCue(), afterText: 'x' }, false, 'Spanish')).toBe('After Spanish.');
		expect(cueWords(emptyCue(), false)).toBe('');
	});
	it('levels and streak', () => {
		expect(levelWords(defaultLevels())).toBe('Off.');
		expect(levelWords({ enabled: true, minimum: 'One page', target: '', stretch: 'Forty pages!' })).toBe('Minimum: One page. Stretch: Forty pages!');
		const h = { streakRule: { kind: 'neverTwice' as const }, minimumCounts: true, unlogged: 'missed' as const, levels: { ...defaultLevels(), enabled: true } };
		expect(streakWords(h, { group: false, build: true })).toBe('Never miss twice: one miss is forgiven. A Minimum counts. A day you don’t log is a miss.');
		expect(streakWords({ ...h, streakRule: { kind: 'grace', misses: 1, period: 'week' }, minimumCounts: false, unlogged: 'ignore' }, { group: false, build: true })).toBe(
			'1 miss a week is forgiven. Only the full target counts. A day you don’t log doesn’t count.'
		);
		expect(streakWords({ ...h, streakRule: { kind: 'grace', misses: 2, period: 'month' } }, { group: false, build: false })).toBe('2 misses a month are forgiven.');
		expect(streakWords(h, { group: true, build: true })).not.toContain('don’t log');
	});
	it('breaking', () => {
		expect(limitWords(null)).toBe('Quit: no limit.');
		expect(limitWords({ max: 6, period: 'day', start: '2026-01-01', taper: { by: 1, every: 'month', floor: 0 } })).toBe('6 a day. Drops by 1 a month, to 0.');
		expect(insteadWords({ when: 'want one', then: 'walk', habitId: null })).toBe('When I want one, I walk.');
		expect(insteadWords({ when: '', then: '', habitId: 'x' }, 'Tea')).toBe('When I feel the urge, I do Tea.');
		expect(insteadWords({ when: '', then: '', habitId: null })).toBe('');
		expect(costWords({ amount: 0.45, unit: '€', perDay: 12 })).toBe('0.45 € each, 12 a day before.');
	});
	it('what keeps you at it', () => {
		expect(treatWords({ reward: 'a new record', strict: true })).toBe('With a new record, only after it’s done.');
		expect(jarWords({ amount: 2, unit: '€', goal: 'shoes' })).toBe('2 € each time, toward shoes.');
		expect(celebrateWords({ celebrate: true, message: 'Another one', jar: null })).toBe('Says: Another one');
		expect(raiseWords({ after: 6, by: 1, unit: 'steps' })).toBe('After 6 times at target, up a step.');
		expect(noteWords('\n## Why\n**Because**')).toBe('Why');
	});
});
