// convert_unit: change the unit of the field with one name in many Tasks ("every Weight field
// from kg to lb"), and in the Library Tasks inside them (a workout's exercises). Each field is
// checked as the Task editor checks a unit change (the conflict rules and the unit's history
// policy), and converted with the same function, which here also reports every row it writes so
// Undo can put the old numbers back exactly.
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../db';
import { metric, task, taskPart } from '../db/schema';
import { getTaskForm } from '../repo/tasks';
import { convertMetricValues, taskLogged } from '../history';
import { emit } from '../core/events';
import { blocked } from '$lib/rules/core';
import { checkTaskPast, metricRules } from '$lib/rules/task';
import { MAX_DEPTH } from '$lib/engine/parts';
import { effectiveUnit } from '$lib/units';
import { getUnits } from '../settings';
import { plural } from './report';
import type { TaskRow } from './select';
import type { Run } from './types';

const norm = (s: string) => s.trim().toLowerCase();

/** A Task to look in, and where it sits: "Upper body › Bench press" for one inside another. */
interface Place {
	id: string;
	path: string;
}

/**
 * The selected Tasks, then with `inside` the Library Tasks inside them, level by level down to
 * the nesting cap. Each Task once, at the first place it is reached: a selected one at the top.
 * Private steps are tick boxes with no fields, so only Library Tasks are followed. `kids` is
 * what sits inside what, for telling which selected Tasks had the field somewhere.
 */
function places(accountId: string, tasks: TaskRow[], inside: boolean): { places: Place[]; kids: Map<string, string[]> } {
	const out: Place[] = tasks.map((t) => ({ id: t.id, path: t.name }));
	const kids = new Map<string, string[]>();
	const seen = new Set(out.map((p) => p.id));
	let level = out;
	for (let depth = 0; inside && level.length && depth < MAX_DEPTH; depth++) {
		const byId = new Map(level.map((p) => [p.id, p]));
		const next: Place[] = [];
		const rows = db
			.select({ parent: taskPart.taskId, id: task.id, name: task.name })
			.from(taskPart)
			.innerJoin(task, eq(taskPart.childTaskId, task.id))
			.where(and(inArray(taskPart.taskId, [...byId.keys()]), eq(taskPart.archived, false), ne(taskPart.id, taskPart.childTaskId), eq(task.accountId, accountId)))
			.orderBy(taskPart.sortOrder)
			.all();
		for (const k of rows) {
			kids.set(k.parent, [...(kids.get(k.parent) ?? []), k.id]);
			if (seen.has(k.id)) continue;
			seen.add(k.id);
			next.push({ id: k.id, path: `${byId.get(k.parent)!.path} › ${k.name}` });
		}
		out.push(...next);
		level = next;
	}
	return { places: out, kids };
}

/** Does this Task, or anything inside it, hold one of `ids`? */
function reaches(id: string, ids: Set<string>, kids: Map<string, string[]>, seen = new Set<string>()): boolean {
	if (ids.has(id)) return true;
	seen.add(id);
	return (kids.get(id) ?? []).some((k) => !seen.has(k) && reaches(k, ids, kids, seen));
}

export const convertUnit: Run<'convert_unit'> = ({ actor, undo, report }, tasks, { field, to, values, inside }) => {
	// "lbs" is saved as the table's "lb"; a unit it doesn't know is kept as written.
	const table = getUnits(actor.accountId);
	const unit = table.find(to)?.name ?? to.trim();
	const shown = (u: string) => u || 'no unit';
	let converted = 0;
	const found = new Set<string>();
	const tree = places(actor.accountId, tasks, inside);
	for (const t of tree.places) {
		const form = getTaskForm(actor.accountId, t.id);
		if (!form) continue;
		const matches = form.metrics.filter((m) => norm(m.name) === norm(field));
		if (!matches.length) continue;
		found.add(t.id);
		const logged = taskLogged(t.id);
		for (const m of matches) {
			const line = { id: m.id, label: `${t.path} › ${m.name}` };
			const nextForm = { ...form, metrics: form.metrics.map((x) => (x.id === m.id ? { ...x, unit } : x)) };
			const next = nextForm.metrics.find((x) => x.id === m.id)!;
			// Conflict rules: only numbers, counts and durations have a unit.
			const rule = blocked(metricRules, next, 'unit', undefined);
			if (rule) {
				report.skip(rule.reason, line);
				continue;
			}
			const from = effectiveUnit(m);
			const change = table.change(from, unit);
			if (change.kind === 'same') {
				report.skip(`Already in ${shown(unit)}`, line);
				continue;
			}
			if (values === 'convert' && change.kind !== 'convertible') {
				report.skip(`${from || 'No unit'} can't be converted to ${shown(unit)}. Keep the numbers instead, or add a new field`, line);
				continue;
			}
			// History policy for a unit: once logged, past values follow the choice made.
			const past = checkTaskPast(form, nextForm, logged, table, { [m.id]: values });
			if (past.errors[0]) {
				report.skip(past.errors[0].reason, line);
				continue;
			}
			const factor = values === 'convert' && change.kind === 'convertible' ? change.factor : null;
			const row = db.select({ unit: metric.unit }).from(metric).where(eq(metric.id, m.id)).get();
			const op = factor ? undo.convert({ taskId: t.id, metricId: m.id, unitBefore: row?.unit ?? null, factor, entries: [] }) : null;
			undo.row('metric', m.id, { unit: row?.unit ?? null }, { unit });
			db.update(metric).set({ unit }).where(eq(metric.id, m.id)).run();
			let valueCount = 0;
			let targetCount = 0;
			if (factor)
				convertMetricValues(db, actor.accountId, t.id, m.id, factor, (table, id, before, after) => {
					undo.row(table, id, before, after);
					if (table === 'entry') {
						valueCount++;
						op!.entries.push(id);
					}
					if (table === 'slot' || table === 'taskPart') targetCount++;
				});
			if (logged.metrics.has(m.id))
				emit(actor, 'metric.unit_changed', { data: { taskId: t.id, metricId: m.id, from, to: unit, converted: !!factor, factor: factor ?? 1 } });
			converted += valueCount;
			const what = factor
				? valueCount || targetCount
					? `${[valueCount ? plural(valueCount, 'value') : '', targetCount ? plural(targetCount, 'target') : ''].filter(Boolean).join(' and ')} converted`
					: 'nothing logged yet'
				: 'numbers kept';
			report.change({ ...line, detail: `${shown(from)} → ${shown(unit)}, ${what}` });
		}
	}
	// A selected Task with no such field, here or in anything inside it.
	for (const t of tasks)
		if (!reaches(t.id, found, tree.kids)) report.skip(`No field called “${field.trim()}”${tree.kids.has(t.id) ? ', here or inside it' : ''}`, { id: t.id, label: t.name });
	report.summary(
		report.count ? `${field.trim()}: ${plural(report.count, 'field')} now in ${shown(unit)}${converted ? `, ${plural(converted, 'value')} converted` : ''}` : 'Nothing to change'
	);
};
