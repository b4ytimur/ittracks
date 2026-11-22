// convert_unit: change the unit of the field with one name in many Tasks ("every Weight field
// from kg to lb"). Each field is checked as the Task editor checks a unit change (the conflict
// rules and the unit's history policy), and converted with the same function, which here also
// reports every row it writes so Undo can put the old numbers back exactly.
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { metric } from '../db/schema';
import { getTaskForm } from '../repo/tasks';
import { convertMetricValues, taskLogged } from '../history';
import { emit } from '../core/events';
import { blocked } from '$lib/rules/core';
import { checkTaskPast, metricRules } from '$lib/rules/task';
import { effectiveUnit, findUnit, unitChange } from '$lib/units';
import { plural } from './report';
import type { Run } from './types';

const norm = (s: string) => s.trim().toLowerCase();

export const convertUnit: Run<'convert_unit'> = ({ actor, undo, report }, tasks, { field, to, values }) => {
	// "lbs" is saved as the registry's "lb"; a unit it doesn't know is kept as written.
	const unit = findUnit(to)?.key ?? to.trim();
	const shown = (u: string) => u || 'no unit';
	let converted = 0;
	for (const t of tasks) {
		const form = getTaskForm(actor.accountId, t.id);
		if (!form) continue;
		const matches = form.metrics.filter((m) => norm(m.name) === norm(field));
		if (!matches.length) {
			report.skip(`No field called “${field.trim()}”`, { id: t.id, label: t.name });
			continue;
		}
		const logged = taskLogged(t.id);
		for (const m of matches) {
			const line = { id: m.id, label: `${t.name} › ${m.name}` };
			const nextForm = { ...form, metrics: form.metrics.map((x) => (x.id === m.id ? { ...x, unit } : x)) };
			const next = nextForm.metrics.find((x) => x.id === m.id)!;
			// Conflict rules: only numbers, counts and durations have a unit.
			const rule = blocked(metricRules, next, 'unit', undefined);
			if (rule) {
				report.skip(rule.reason, line);
				continue;
			}
			const from = effectiveUnit(m);
			const change = unitChange(from, unit);
			if (change.kind === 'same') {
				report.skip(`Already in ${shown(unit)}`, line);
				continue;
			}
			if (values === 'convert' && change.kind !== 'convertible') {
				report.skip(`${from || 'No unit'} can't be converted to ${shown(unit)}. Keep the numbers instead, or add a new field`, line);
				continue;
			}
			// History policy for a unit: once logged, past values follow the choice made.
			const past = checkTaskPast(form, nextForm, logged, { [m.id]: values });
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
	report.summary(
		report.count ? `${field.trim()}: ${plural(report.count, 'field')} now in ${shown(unit)}${converted ? `, ${plural(converted, 'value')} converted` : ''}` : 'Nothing to change'
	);
};
