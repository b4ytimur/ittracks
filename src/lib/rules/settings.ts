// Conflict rules for Settings. G1: parts of the day can't overlap. Habits point to a part by
// name, so removing a part a habit uses is a warning.
import type { Settings } from '../server/settings';
import { minutesOf, type DayRange } from '../engine/day';
import { check, defineRules, evaluate, independent, type Issue } from './core';

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

export interface SettingsCtx {
	/** Names of the parts of the day that habits are set for. */
	usedRanges: string[];
}

const noCtx: SettingsCtx = { usedRanges: [] };

/** Parts of the day that habits use but the settings no longer have. */
export const missingRanges = (s: Pick<Settings, 'ranges'>, c: SettingsCtx) =>
	[...new Set(c.usedRanges)].filter((n) => !s.ranges.some((r) => r.name === n));

export const settingsRules = defineRules<Settings, SettingsCtx>({
	weightUnit: independent,
	timeZone: independent,
	dayStart: independent,
	ranges: [
		check((s) => s.ranges.some((r) => r.start === r.end), 'A part of the day must end at a different time than it starts'),
		check((s) => !!overlappingRanges(s.ranges), 'Parts of the day can\'t overlap'),
		check(
			(s, c) => missingRanges(s, c).length > 0,
			'A habit is set for a part of the day you removed. It won\'t have a time or a reminder until you pick another part in its editor',
			'warn'
		)
	],
	guidedSetup: independent,
	showAllSections: independent,
	groupByArea: independent,
	/** View settings have their own registry: rules/views.ts. */
	views: independent,
	pinned: independent,
	taskTypes: independent,
	areasSeeded: independent
});

export function checkSettings(s: Settings, ctx: SettingsCtx = noCtx): Issue[] {
	return evaluate(settingsRules, s, ctx);
}
