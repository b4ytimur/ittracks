// set: give many habits the same value for bulk-editable fields (habitBulk in rules/habit.ts).
// Each habit is checked as the editor's save would check it: the conflict rules say where a value
// can't apply (a reminder needs a time), and the history policies say whether past days care.
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { habit } from '../db/schema';
import { checkHabitForm, getHabitForm, habitCtx } from '../repo/habits';
import { habitLogged } from '../history';
import { listAreas } from '../repo/areas';
import { blocked, get, set as setPath, type FieldPath } from '$lib/rules/core';
import { checkHabitPast, habitBulk, habitRules, type HabitBulkField } from '$lib/rules/habit';
import type { HabitForm } from '$lib/forms';
import { areaOf } from './select';
import { same } from './undo';
import { plural } from './report';
import type { Run } from './types';

export const setFields: Run<'set'> = ({ actor, undo, report }, habits, input) => {
	const areas = listAreas(actor.accountId);
	// Values as stored: an Area named by the caller becomes its id.
	const values = Object.fromEntries(
		Object.entries(input.set)
			.filter(([, v]) => v !== undefined)
			.map(([k, v]) => [k, k === 'areaId' && typeof v === 'string' ? areaOf(actor.accountId, v) : v])
	) as Partial<Record<HabitBulkField, unknown>>;
	const fields = Object.keys(values) as HabitBulkField[];
	const shown = (k: HabitBulkField, v: unknown) =>
		k === 'areaId' ? (v ? (areas.find((a) => a.id === v)?.name ?? '') : 'no Area') : typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v);
	const detail = fields.map((k) => `${habitBulk[k].label}: ${shown(k, values[k])}`).join(', ');

	for (const h of habits) {
		const line = { id: h.id, label: h.name };
		const form = getHabitForm(actor.accountId, h.id);
		if (!form) continue;
		let patched: HabitForm = form;
		for (const k of fields) patched = setPath(patched, k, values[k]);
		const todo = fields.filter((k) => !same(get(form, k), values[k]));
		if (!todo.length) {
			report.skip('Already set', line);
			continue;
		}
		// Conflict rules: a value the save would clear, or a rule it would break, can't be set here.
		const checked = checkHabitForm(patched);
		const ctx = habitCtx(patched);
		const refused = todo
			.map((k) => {
				if (same(get(checked.form, k), values[k]) && !checked.errors.some((e) => e.path === k)) return null;
				return blocked(habitRules, patched, k as FieldPath<HabitForm>, ctx)?.reason ?? checked.errors.find((e) => e.path === k)?.reason ?? "It can't be set on this habit";
			})
			.filter((r): r is string => !!r);
		if (refused.length) {
			report.skip(refused[0], line);
			continue;
		}
		// History policies: a field past days depend on is refused once something is logged.
		const past = checkHabitPast(form, patched, true);
		if (past.length && habitLogged(h.id)) {
			report.skip(past[0].reason, line);
			continue;
		}
		const before = Object.fromEntries(todo.map((k) => [k, get(form, k)]));
		const after = Object.fromEntries(todo.map((k) => [k, values[k]]));
		undo.row('habit', h.id, before, after);
		db.update(habit).set(after as Partial<typeof habit.$inferInsert>).where(eq(habit.id, h.id)).run();
		report.change({ ...line, detail });
	}
	report.summary(report.count ? `Set ${detail} for ${plural(report.count, 'habit')}` : 'Nothing to change');
};
