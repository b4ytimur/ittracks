// set: give many habits the same value for bulk-editable fields (habitBulk in rules/habit.ts).
// Each habit is checked as the editor's save would check it: the conflict rules say where a value
// can't apply (a reminder needs a time), and the history policies say whether past days care.
import { getHabitForm, checkHabitForm, habitCtx } from '../repo/habits';
import { habitLogged } from '../history';
import { listAreas } from '../repo/areas';
import { blocked, get, set as setPath, type FieldPath } from '$lib/rules/core';
import { checkHabitPast, habitBulk, habitPast, habitRules, type HabitBulkField } from '$lib/rules/habit';
import type { HabitForm } from '$lib/forms';
import { areaOf } from './select';
import { same } from './undo';
import { plural } from './report';
import { writeHabitFields } from './habit-fields';
import type { Run } from './types';

/** A value as the preview says it: "Fitness", "on", "Grace days: 2 per week". */
function shown(k: HabitBulkField, v: unknown, areas: { id: string; name: string }[]): string {
	if (k === 'areaId') return v ? (areas.find((a) => a.id === v)?.name ?? '') : 'no Area';
	const f = habitBulk[k];
	if ('fields' in f && v && typeof v === 'object') {
		const r = v as Record<string, unknown>;
		const kind = f.fields[0].kind === 'choice' ? f.fields[0].options.find((o) => o.value === r.kind)?.label.split(':')[0] : null;
		const rest = r.kind === 'grace' ? `${r.misses} per ${r.period}` : r.kind === 'consistency' ? `over ${r.days} days` : '';
		return [kind ?? String(r.kind), rest].filter(Boolean).join(': ');
	}
	if ('editor' in f && f.editor.kind === 'choice') return f.editor.options.find((o) => o.value === v)?.label.split(':')[0] ?? String(v);
	return typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v);
}

export const setFields: Run<'set'> = ({ actor, undo, report }, habits, input) => {
	const areas = listAreas(actor.accountId);
	// Values as stored: an Area named by the caller becomes its id.
	const values = Object.fromEntries(
		Object.entries(input.set)
			.filter(([, v]) => v !== undefined)
			.map(([k, v]) => [k, k === 'areaId' && typeof v === 'string' ? areaOf(actor.accountId, v) : v])
	) as Partial<Record<HabitBulkField, unknown>>;
	const fields = Object.keys(values) as HabitBulkField[];
	const detail = fields.map((k) => `${habitBulk[k].label}: ${shown(k, values[k], areas)}`).join(', ');

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
		// History policies: a field past days depend on is refused once something is logged, and
		// one whose results are worked out from the logs says so.
		const logged = habitLogged(h.id);
		const past = checkHabitPast(form, patched, true);
		if (past.length && logged) {
			report.skip(past[0].reason, line);
			continue;
		}
		if (logged) for (const k of todo) if (habitPast[k].kind === 'recompute') report.note(`${habitBulk[k].label}: ${habitPast[k].past}.`);
		const before = Object.fromEntries(todo.map((k) => [k, get(form, k) ?? null]));
		const after = Object.fromEntries(todo.map((k) => [k, values[k]]));
		undo.habit(h.id, before, after);
		writeHabitFields(h.id, before, after);
		// A rule's warning is still allowed, as in the editor, but said next to the habit.
		const warning = checked.warnings.find((w) => todo.includes(w.path as HabitBulkField));
		report.change({ ...line, detail: warning ? `${detail}. ${warning.reason}` : detail });
	}
	report.summary(report.count ? `Set ${detail} for ${plural(report.count, 'habit')}` : 'Nothing to change');
};
