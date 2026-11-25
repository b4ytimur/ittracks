// One change to a habit at a time: the fields it sets, checked against what they were, so a save
// from an old page never overwrites what another one changed.
import { z } from 'zod';
import { firstError, habitForm, type HabitForm } from '$lib/forms';
import { checkHabitEdit, checkHabitForm, checkLinks, getHabitForm, saveHabit, type ScheduleApplies } from './repo/habits';
import { PastEditError } from './history';
import { withSnapshot } from './snapshot';
import { routineTurnFor } from './routine-start';

export const habitPatch = z.object({
	set: z.record(z.string(), z.unknown()),
	/** What each of those fields was on the page that sends this. */
	was: z.record(z.string(), z.unknown()),
	applies: z.enum(['today', 'past']).default('today'),
	/** It rewrites past days: keep what it replaces, for its Undo. */
	keep: z.boolean().default(false),
	/** In the app icon's menu: a setting, not part of the habit. */
	pinned: z.boolean().optional()
});
export type HabitPatch = z.infer<typeof habitPatch>;

export type PatchResult = { form: HabitForm; undo?: string; /** Another habit it changed, in words. */ said?: string } | { error: string; status: 400 | 404 } | { moved: Record<string, unknown>; form: HabitForm };

const ordered = (v: unknown): string =>
	JSON.stringify(v ?? null, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/** The habit as its page has it: what can't apply is cleared the same way on both sides. */
export function currentForm(accountId: string, id: string): HabitForm | null {
	const f = getHabitForm(accountId, id);
	return f && checkHabitForm(f).form;
}

export function patchHabit(accountId: string, id: string, p: HabitPatch, today: string): PatchResult {
	const now = currentForm(accountId, id);
	if (!now) return { error: 'No such habit', status: 404 };
	const keys = Object.keys(p.set).filter((k) => k in habitForm.shape);
	if (!keys.length) return { error: 'Nothing to change', status: 400 };
	const cur = now as Record<string, unknown>;
	// Asking for what is there already is not a conflict.
	const moved = keys.filter((k) => ordered(cur[k]) !== ordered(p.was[k]) && ordered(cur[k]) !== ordered(p.set[k]));
	if (moved.length) return { moved: Object.fromEntries(moved.map((k) => [k, cur[k]])), form: now };
	const parsed = habitForm.safeParse({ ...now, ...Object.fromEntries(keys.map((k) => [k, p.set[k]])) });
	if (!parsed.success) return { error: firstError(parsed.error), status: 400 };
	const problem = checkHabitForm(parsed.data).errors[0]?.reason ?? checkLinks(accountId, id, parsed.data) ?? checkHabitEdit(accountId, id, parsed.data);
	if (problem) return { error: problem, status: 400 };
	// The line's days: an Area line's say which days its Area counts on, any other line's which days its schedule does.
	const area = keys.length === 1 && keys[0] === 'areaId';
	const applies = p.applies as ScheduleApplies;
	const save = () => saveHabit(accountId, id, parsed.data, today, area ? { areaApplies: applies } : { scheduleApplies: applies });
	// Starting to follow a routine not yet begun turns it to start where this habit is now: said, and undone with it.
	const turn = routineTurnFor(accountId, id, parsed.data, today);
	try {
		// A move into a group for past days too can move the group's start back: kept for the Undo too.
		const into = typeof p.set.parentId === 'string' ? [p.set.parentId] : turn ? [turn.routineId] : [];
		const undo = p.keep || turn ? withSnapshot(accountId, id, save, Date.now(), into).undo : (save(), undefined);
		return { form: currentForm(accountId, id)!, undo, ...(turn ? { said: turn.said } : {}) };
	} catch (e) {
		if (e instanceof PastEditError) return { error: e.message, status: 400 };
		throw e;
	}
}
