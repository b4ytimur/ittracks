// Conflict rules for Settings. G1: parts of the day can't overlap.
import type { Settings } from '../server/settings';
import { minutesOf, type DayRange } from '../engine/day';
import { check, defineRules, evaluate, independent, normalize, onlyWhen, type Issue } from './core';

/** Minutes of the day a range covers, as [start, end) spans that don't wrap. */
function spans(r: DayRange): [number, number][] {
	const a = minutesOf(r.start);
	const b = minutesOf(r.end);
	return a < b ? [[a, b]] : [[a, 1440], [0, b]];
}

/** The first two ranges that share a minute, or null. */
export function overlappingRanges(ranges: DayRange[]): [DayRange, DayRange] | null {
	for (let i = 0; i < ranges.length; i++)
		for (let j = i + 1; j < ranges.length; j++)
			for (const [a1, b1] of spans(ranges[i]))
				for (const [a2, b2] of spans(ranges[j])) if (a1 < b2 && a2 < b1) return [ranges[i], ranges[j]];
	return null;
}

export const settingsRules = defineRules<Settings>({
	weightUnit: independent,
	timeZone: independent,
	dayStart: independent,
	ranges: [
		check((s) => s.ranges.some((r) => r.start === r.end), 'A part of the day must end at a different time than it starts'),
		check((s) => !!overlappingRanges(s.ranges), 'Parts of the day can\'t overlap')
	],
	guidedSetup: independent,
	showAllSections: independent,
	groupByArea: independent,
	/** View settings have their own registry: rules/views.ts. */
	views: independent,
	pinned: independent,
	taskTypes: independent,
	areasSeeded: independent,
	pastDays: [
		check((s) => s.pastDays !== null && (!Number.isInteger(s.pastDays) || s.pastDays < 0 || s.pastDays > 3650), 'Pick how many days back can be logged')
	],
	/** The nudge links to logging yesterday, so it needs past-day logging on. */
	nudgeYesterday: [onlyWhen((s) => s.pastDays !== 0, 'Turn on logging past days first', false)]
});

export function checkSettings(s: Settings): Issue[] {
	return evaluate(settingsRules, s, undefined);
}

/** Settings with options that can't apply cleared, before saving. */
export function cleanSettings(s: Settings): Settings {
	return normalize(settingsRules, s, undefined).form;
}
