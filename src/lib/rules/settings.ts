// Conflict rules for Settings. G1: parts of the day can't overlap. Habits point to a part by
// name, so removing a part a habit uses is a warning.
import type { Settings } from '../server/settings';
import { minutesOf, type DayRange } from '../engine/day';
import { check, defineRules, evaluate, independent, normalize, onlyWhen, type Issue } from './core';
import { groupingsProblem } from '../groupings';
import { kindsProblem } from '../units';
import { readViews } from '../views';

/** Is the Journal feature switched off in Features? */
export const journalOff = (s: Pick<Settings, 'views'>) => readViews(s.views).hidden.includes('journal');

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
	/** Which table can be is in units.ts (kindsProblem). */
	units: [check((s) => !!s.units && !!kindsProblem(s.units), 'These units can\'t be saved')],
	/** Which list can be is in groupings.ts (groupingsProblem). */
	groupings: [check((s) => !!s.groupings && !!groupingsProblem(s.groupings), 'These groupings can\'t be saved')],
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
	packs: independent,
	hints: independent,
	areasSeeded: independent,
	/** Stats boards, cards and measures have their own registry: rules/stats.ts. */
	stats: independent,
	pastDays: [
		check((s) => s.pastDays !== null && (!Number.isInteger(s.pastDays) || s.pastDays < 0 || s.pastDays > 3650), 'Pick how many days back can be logged')
	],
	/** The nudge links to logging yesterday, so it needs past-day logging on. */
	nudgeYesterday: [onlyWhen((s) => s.pastDays !== 0, 'Turn on logging past days first', false)],
	/**
	 * J3: the day note is part of the Journal feature. Switching a feature off keeps its data
	 * and settings (FEATURES in views.ts), so this warns instead of clearing.
	 */
	detail: [],
	logLayouts: [],
	newLines: [],
	dayNote: [check((s) => s.dayNote && journalOff(s), 'The Journal feature is switched off, so the day note stays hidden until you switch it back on', 'warn')]
});

export function checkSettings(s: Settings, ctx: SettingsCtx = noCtx): Issue[] {
	return evaluate(settingsRules, s, ctx);
}

/** Settings with options that can't apply cleared, before saving. */
export function cleanSettings(s: Settings): Settings {
	return normalize(settingsRules, s, noCtx).form;
}
