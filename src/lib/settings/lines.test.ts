import { describe, expect, it } from 'vitest';
import { starterGroupings } from '$lib/groupings';
import { STARTER_KINDS } from '$lib/units';
import { FEATURES } from '$lib/views';
import { FEATURE_HIDES, matches, settingGroups, type Now } from './lines';

const now: Now = {
	today: '2026-11-25',
	username: 'me',
	dayStart: null,
	ranges: [],
	vacations: [],
	pastDays: null,
	nudgeYesterday: true,
	dayNote: false,
	journalOff: false,
	guidedSetup: true,
	units: STARTER_KINDS,
	measures: [],
	taskTypes: [],
	packs: [],
	groupings: starterGroupings(),
	startPage: 'Today',
	hidden: [],
	devices: 0,
	habits: 0,
	keys: [],
	backup: { plan: { every: 0, folder: '/data/backups', keep: 30 }, state: {} },
	waiting: 0
};
const words = (id: string, o: Partial<Now> = {}) => settingGroups({ ...now, ...o }).flatMap((g) => g.lines).find((l) => l.id === id)!.words;

describe('the words of a setting', () => {
	it('say how it is now', () => {
		expect(words('daystart')).toBe('At midnight.');
		expect(words('daystart', { dayStart: '04:00' })).toBe('At 04:00.');
		expect(words('past', { pastDays: 7 })).toBe('Up to a week back. Today asks about yesterday.');
		expect(words('past', { pastDays: 5, nudgeYesterday: false })).toBe('Up to 5 days back.');
		expect(words('past', { pastDays: 0, nudgeYesterday: false })).toBe('Off. Only today can be logged.');
		expect(words('daynote', { dayNote: true, journalOff: true })).toBe('On, and hidden while the Journal is off.');
		expect(words('units')).toBe('Time, Weight in kg, Distance in km.');
		expect(words('features', { hidden: ['levels', 'journal'] })).toBe('7 in use. Off: Levels, Journal.');
		expect(words('logout', { waiting: 1 })).toBe('1 change on this device is not saved yet.');
	});
	it('a vacation that is over is not planned', () => {
		const v = (start: string, end: string) => ({ start, end, note: null });
		expect(words('vacation', { vacations: [v('2026-01-01', '2026-01-05')] })).toBe('None planned.');
		expect(words('vacation', { vacations: [v('2026-01-01', '2026-01-05'), v('2026-11-20', '2026-11-30'), v('2026-12-20', '2026-12-30')] })).toMatch(/^On vacation until .*, and 1 more\.$/);
	});
	it('every feature says what it hides, and every line has its own id', () => {
		expect(Object.keys(FEATURE_HIDES).sort()).toEqual(Object.keys(FEATURES).sort());
		const ids = settingGroups(now).flatMap((g) => g.lines.map((l) => l.id));
		expect(new Set(ids).size).toBe(ids.length);
	});
	it('finds a line by every word typed, in any order', () => {
		expect(matches('back DAYS', 'Logging past days', 'Up to a week back')).toBe(true);
		expect(matches('days never', 'Logging past days')).toBe(false);
	});
});
