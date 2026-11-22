// Sharing a habit as a template file: the Tasks it uses, the Library Tasks its auto-filled
// Slots can pick, Area names, and what the person sharing adds (description, questions).
import { getHabitForm, listHabits } from './repo/habits';
import { listIdentities } from './repo/identities';
import { getTaskForm } from './repo/tasks';
import { listAreas } from './repo/areas';
import { candidates } from './today';
import { matches, type FillRule } from '$lib/engine/fill';
import { toTemplate, type ShareDetails, type TemplateFile } from '$lib/template';
import { scheduleDays, type ShareCtx } from '$lib/share';
import type { HabitForm, TaskForm } from '$lib/forms';

/** Library Tasks an auto-filled Slot of this habit can pick, by id (Tasks already in a fixed Slot left out). */
export function poolTaskIds(accountId: string, habit: HabitForm): string[] {
	const rules = habit.variants.flatMap((v) => v.slots.flatMap((s) => (s.fillRule ? [s.fillRule as FillRule] : [])));
	if (!rules.length) return [];
	const fixed = new Set(habit.variants.flatMap((v) => v.slots.map((s) => s.taskId)));
	return candidates(accountId)
		.filter((c) => !fixed.has(c.id) && rules.some((r) => matches(r, c.tags)))
		.map((c) => c.id);
}

export interface ShareOptions extends ShareDetails {
	/** Leave out the Library Tasks that auto-filled Slots pick from (default: included). */
	noPool?: boolean;
}

/** The template file for a habit, or null when it isn't the account's. */
export function shareFile(accountId: string, habitId: string, opts: ShareOptions = {}): TemplateFile | null {
	const habit = getHabitForm(accountId, habitId);
	if (!habit) return null;
	const tasks = new Map<string, TaskForm>();
	const add = (id: string) => {
		if (tasks.has(id)) return;
		const t = getTaskForm(accountId, id);
		if (t) tasks.set(id, t);
	};
	for (const v of habit.variants) for (const s of v.slots) if (s.taskId) add(s.taskId);
	// Without them, an auto-filled Slot finds nothing to pick on the other side.
	if (!opts.noPool) for (const id of poolTaskIds(accountId, habit)) add(id);
	return toTemplate(
		habit,
		tasks,
		{
			habits: new Map(listHabits(accountId).map((h) => [h.id, h.name])),
			identities: new Map(listIdentities(accountId).map((i) => [i.id, i.statement])),
			areas: new Map(listAreas(accountId).map((a) => [a.id, a.name]))
		},
		opts
	);
}

/** A file name for a template: "push-pull-legs.ittracks.json". */
export const templateFileName = (name: string) =>
	`${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'habit'}.ittracks.json`;

/** A field a number question can set: a number in a fixed Slot's Task, with the first target found. */
export interface ShareMetric {
	id: string;
	task: string;
	name: string;
	unit: string;
	target: number | null;
}

/** What the Share page needs: the facts the form's rules read, the fields to ask about, and the pool. */
export function shareContext(accountId: string, habitId: string) {
	const habit = getHabitForm(accountId, habitId);
	if (!habit) return null;
	const metrics: ShareMetric[] = [];
	const seen = new Set<string>();
	const withHowTo = new Set<string>();
	for (const v of habit.variants)
		for (const s of v.slots) {
			if (!s.taskId) continue;
			const t = getTaskForm(accountId, s.taskId);
			if (!t) continue;
			if (t.notes.trim()) withHowTo.add(s.taskId);
			for (const m of t.metrics) {
				if (!['number', 'count', 'duration'].includes(m.type)) continue;
				const target = s.targets[m.id] ?? null;
				const known = metrics.find((x) => x.id === m.id);
				if (known) {
					known.target ??= target;
					continue;
				}
				if (seen.has(m.id)) continue;
				seen.add(m.id);
				metrics.push({ id: m.id, task: t.name, name: m.name, unit: m.unit || (m.type === 'duration' ? 'min' : ''), target });
			}
		}
	const pool = poolTaskIds(accountId, habit);
	const poolTasks = pool.flatMap((id) => {
		const t = getTaskForm(accountId, id);
		return t ? [{ id, ...t }] : [];
	});
	for (const t of poolTasks) if (t.notes.trim()) withHowTo.add(t.id);
	const area = habit.areaId ? (listAreas(accountId).find((a) => a.id === habit.areaId)?.name ?? null) : null;
	const days = scheduleDays(habit.schedule);
	const ctx: ShareCtx = {
		daysFit: habit.direction === 'build' && days.fit,
		days: days.days,
		time: habit.cue.time,
		range: habit.cue.range,
		area,
		pool: pool.length,
		remind: habit.remind,
		note: !!habit.notes.trim(),
		howTo: withHowTo.size,
		metricIds: metrics.map((m) => m.id)
	};
	const poolNames = poolTasks.map((t) => t.name);
	return { habit, ctx, metrics, poolNames };
}
