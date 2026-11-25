// One change to the settings at a time: the fields it sets, checked against what they were, so a
// page left open never overwrites what another one changed. Says exactly what it changed, so its
// Undo can put that back.
import { z } from 'zod';
import { checkSettings, cleanSettings } from '$lib/rules/settings';
import { firstError } from '$lib/forms';
import { renameRanges } from './repo/ranges';
import { getSettings, saveSettings, type Settings } from './settings';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Pick a time like 04:00');

const fields = z
	.object({
		/** Null goes back to not set. */
		dayStart: hhmm.nullable(),
		ranges: z.array(z.object({ name: z.string().trim().min(1, 'Give each part of the day a name').max(40), start: hhmm, end: hhmm })).max(12, 'At most 12 parts of the day'),
		pastDays: z.number().int().nullable(),
		nudgeYesterday: z.boolean(),
		dayNote: z.boolean(),
		guidedSetup: z.boolean(),
		showAllSections: z.boolean(),
		weightUnit: z.string().trim().min(1, 'Enter a weight unit, like kg or lb').max(20)
	})
	.partial()
	.strict();
export type SettingsSet = z.infer<typeof fields>;

export const settingsPatch = z.object({
	set: fields,
	was: z.record(z.string(), z.unknown()),
	/** Parts of the day by their old name, when one was renamed: its habits go with it. */
	renames: z.record(z.string(), z.string()).default({})
});

export type SettingsResult = { was: SettingsSet; now: SettingsSet; renames: Record<string, string> } | { error: string } | { moved: string[] };

const ordered = (v: unknown): string =>
	JSON.stringify(v ?? null, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

export function patchSettings(accountId: string, body: unknown): SettingsResult {
	const parsed = settingsPatch.safeParse(body);
	if (!parsed.success) return { error: firstError(parsed.error) };
	const p = parsed.data;
	const cur = getSettings(accountId);
	const keys = Object.keys(p.set) as (keyof SettingsSet)[];
	if (!keys.length) return { error: 'Nothing to change' };
	const moved = keys.filter((k) => ordered(cur[k]) !== ordered(p.was[k]) && ordered(cur[k]) !== ordered(p.set[k]));
	if (moved.length) return { moved };
	const twice = p.set.ranges?.find((r, i, all) => all.findIndex((x) => x.name.toLowerCase() === r.name.toLowerCase()) < i);
	if (twice) return { error: `Two parts of the day are called “${twice.name}”. Give each its own name.` };
	const next = { ...cur, ...p.set, dayStart: ('dayStart' in p.set ? p.set.dayStart : cur.dayStart) ?? undefined } as Settings;
	const block = checkSettings(next).find((i) => i.severity === 'block');
	if (block) return { error: block.reason };
	const clean = cleanSettings(next);
	// What it clears with it belongs to this change too.
	const changed = (Object.keys(fields.shape) as (keyof SettingsSet)[]).filter((k) => ordered(cur[k]) !== ordered(clean[k]));
	const pick = (s: Settings) => Object.fromEntries(changed.map((k) => [k, s[k] ?? null])) as SettingsSet;
	if (changed.length) saveSettings(accountId, Object.fromEntries(changed.map((k) => [k, clean[k]])) as Partial<Settings>);
	// A rename counts when the old name is gone and the new one is there.
	const has = (n: string) => clean.ranges.some((r) => r.name === n);
	const renames = new Map(Object.entries(p.renames).filter(([from, to]) => from !== to && has(to) && !has(from)));
	renameRanges(accountId, renames);
	return { was: pick(cur), now: pick(clean), renames: Object.fromEntries(renames) };
}
