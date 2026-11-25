// One change to the settings at a time: the fields it sets, checked against what they were, so a
// page left open never overwrites what another one changed. Says exactly what it changed, so its
// Undo can put that back.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { checkSettings, cleanSettings } from '$lib/rules/settings';
import { firstError } from '$lib/forms';
import { groupingList, groupingsProblem } from '$lib/groupings';
import { PLAIN_TASK_TYPES, taskTypeSchema } from '$lib/task-types';
import { kindsProblem, unitKinds, unitTable, unitWord } from '$lib/units';
import { db } from './db';
import { metric, task } from './db/schema';
import { renameRanges } from './repo/ranges';
import { getGroupings, getKinds, getPacks, getSettings, getTaskTypes, saveSettings, type Settings } from './settings';

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
		units: unitKinds,
		groupings: groupingList,
		taskTypes: z.array(taskTypeSchema).max(60)
	})
	.partial()
	.strict();
export type SettingsSet = z.infer<typeof fields>;

export const settingsPatch = z.object({
	set: fields,
	was: z.record(z.string(), z.unknown()),
	/** Parts of the day by their old name, when one was renamed: its habits go with it. */
	renames: z.record(z.string(), z.string()).default({}),
	/** Units by their old name, when one was renamed: the fields written that way go with it. */
	unitRenames: z.record(z.string(), z.string()).default({})
});

export type SettingsResult = { was: SettingsSet; now: SettingsSet; renames: Record<string, string>; unitRenames: Record<string, string> } | { error: string } | { moved: string[] };

/** The account's fields written in this unit. */
const writtenIn = (accountId: string, unit: string) => and(sql`lower(trim(${metric.unit})) = ${unitWord(unit)}`, inArray(metric.taskId, db.select({ id: task.id }).from(task).where(eq(task.accountId, accountId))));
const fieldsIn = (accountId: string, unit: string) => db.select({ id: metric.id }).from(metric).where(writtenIn(accountId, unit)).all();

/** Fields written in a unit's old name get its new one. Their values mean the same. */
function renameUnits(accountId: string, renames: [string, string][]) {
	for (const [from, to] of renames) db.update(metric).set({ unit: to }).where(writtenIn(accountId, from)).run();
}

const ordered = (v: unknown): string =>
	JSON.stringify(v ?? null, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/** Task types without the plain ones, which are always there. */
export const ownTypes = (accountId: string) => getTaskTypes(accountId).filter((t) => !PLAIN_TASK_TYPES.some((p) => p.key === t.key));

export function patchSettings(accountId: string, body: unknown): SettingsResult {
	const parsed = settingsPatch.safeParse(body);
	if (!parsed.success) return { error: firstError(parsed.error) };
	const p = parsed.data;
	// Units and groupings are read as the account has them, also before any were stored.
	const cur: Settings = { ...getSettings(accountId), units: getKinds(accountId), groupings: getGroupings(accountId), taskTypes: ownTypes(accountId) };
	const keys = Object.keys(p.set) as (keyof SettingsSet)[];
	if (!keys.length) return { error: 'Nothing to change' };
	const moved = keys.filter((k) => ordered(cur[k]) !== ordered(p.was[k]) && ordered(cur[k]) !== ordered(p.set[k]));
	if (moved.length) return { moved };
	const twice = p.set.ranges?.find((r, i, all) => all.findIndex((x) => x.name.toLowerCase() === r.name.toLowerCase()) < i);
	if (twice) return { error: `Two parts of the day are called “${twice.name}”. Give each its own name.` };
	const wrong = (p.set.units && kindsProblem(p.set.units)) || (p.set.groupings && groupingsProblem(p.set.groupings));
	if (wrong) return { error: wrong };
	const next = { ...cur, ...p.set, dayStart: ('dayStart' in p.set ? p.set.dayStart : cur.dayStart) ?? undefined } as Settings;
	const block = checkSettings(next).find((i) => i.severity === 'block');
	if (block) return { error: block.reason };
	const clean = cleanSettings(next);
	// A unit's rename counts when the new name is a unit now, and the old one isn't.
	const isUnit = (n: string) => clean.units!.some((k) => k.units.some((x) => unitWord(x.name) === unitWord(n)));
	const moves = Object.entries(p.unitRenames).filter(([from, to]) => from !== to && isUnit(to) && (unitWord(from) === unitWord(to) || !isUnit(from)));
	// Fields that use the new name as a word of its own would become this unit, and its Undo would take them along.
	const before = unitTable(cur.units!);
	const taken = moves.find(([from, to]) => !before.same(from, to) && fieldsIn(accountId, to).length);
	if (taken) return { error: `“${taken[1]}” is already on ${fieldsIn(accountId, taken[1]).length === 1 ? 'a field' : 'fields'} as a word of its own. Pick another name.` };
	// What it clears with it belongs to this change too.
	const changed = (Object.keys(fields.shape) as (keyof SettingsSet)[]).filter((k) => ordered(cur[k]) !== ordered(clean[k]));
	const pick = (s: Settings) => Object.fromEntries(changed.map((k) => [k, s[k] ?? null])) as SettingsSet;
	// Types of an account from before there were packs are stored with the packs they came from.
	if (changed.length) saveSettings(accountId, { ...Object.fromEntries(changed.map((k) => [k, clean[k]])), ...(changed.includes('taskTypes') ? { packs: getPacks(accountId) } : {}) } as Partial<Settings>);
	// A rename counts when the old name is gone and the new one is there.
	const has = (n: string) => clean.ranges.some((r) => r.name === n);
	const renames = new Map(Object.entries(p.renames).filter(([from, to]) => from !== to && has(to) && !has(from)));
	renameRanges(accountId, renames);
	renameUnits(accountId, moves);
	return { was: pick(cur), now: pick(clean), renames: Object.fromEntries(renames), unitRenames: Object.fromEntries(moves) };
}
