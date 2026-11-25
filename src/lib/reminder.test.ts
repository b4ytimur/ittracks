import { expect, it } from 'vitest';
import { noReminder, reminderActions, reminderBody, reminderTime, reminderWords } from './reminder';

const ranges = [{ name: 'Morning', start: '06:00' }];
const h = { cue: { time: null, range: 'Morning', place: 'the gym' }, reminder: null, levels: { enabled: true, minimum: 'two lifts' } };

it('follows the cue unless it has a time, words or buttons of its own', () => {
	expect([reminderTime(h, ranges), reminderBody(h), reminderActions(h).map((a) => a.action)]).toEqual(['06:00', 'Morning the gym · Even two lifts counts.', ['done', 'minimum', 'snooze']]);
	const own = { ...h, reminder: { ...noReminder(), time: '17:45', text: 'Shoes on', minimum: false } };
	expect([reminderTime(own, ranges), reminderBody(own), reminderActions(own).map((a) => a.action)]).toEqual(['17:45', 'Shoes on', ['done', 'snooze']]);
	// A time of its own needs no cue; without either there is nothing to go by.
	expect(reminderTime({ ...own, cue: null }, ranges)).toBe('17:45');
	expect(reminderTime({ ...h, cue: { range: 'Gone' } }, ranges)).toBeNull();
});

it('says itself in words', () => {
	expect(reminderWords({ ...h, remind: false })).toBe('');
	expect(reminderWords({ ...h, remind: true })).toBe('When the morning starts. Offers Done, Minimum and Snooze.');
	expect(reminderWords({ ...h, remind: true, reminder: { time: '17:45', text: 'Shoes on', minimum: false, snooze: false } })).toBe('At 17:45. Says “Shoes on”. Offers Done.');
});
