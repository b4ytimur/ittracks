// Sharing a habit as a template file: the habits inside it, the Tasks they use, the Library
// Tasks their auto-filled Slots can pick, Area names, and what the person sharing adds
// (description, questions).
import { getHabitForm, listHabits } from './repo/habits';
import { listIdentities } from './repo/identities';
import { getTaskForm } from './repo/tasks';
import { listAreas } from './repo/areas';
import { candidates } from './today';
import { matches, type FillRule } from '$lib/engine/fill';
import { templateFile, toTemplate, type InsideHabit, type ShareDetails, type TemplateFile } from '$lib/template';
import { scheduleDays, shareDetails, shareForm, type ShareCtx } from '$lib/share';
import { checkShare, shareRules } from '$lib/rules/share';
import { normalize } from '$lib/rules/core';
import { getGroups, getPacks } from './settings';
import { packsUsed } from '$lib/packs';
import type { HabitForm, TaskForm } from '$lib/forms';
import { isFollow, isGroup } from '$lib/engine/schedule';
import { standaloneSchedule } from '$lib/engine/follow';
import { descendants, flatten } from '$lib/engine/tree';

/** Library Tasks an auto-filled Slot of this habit can pick, by id (Tasks already in a fixed Slot left out). */
export function poolTaskIds(accountId: string, habit: HabitForm): string[] {
	const rules = habit.variants.flatMap((v) => v.slots.flatMap((s) => (s.fillRule ? [s.fillRule as FillRule] : [])));
	if (!rules.length) return [];
	const { rank } = getGroups(accountId);
	const fixed = new Set(habit.variants.flatMap((v) => v.slots.map((s) => s.taskId)));
	return candidates(accountId)
		.filter((c) => !fixed.has(c.id) && rules.some((r) => matches(r, c.tags, rank)))
		.map((c) => c.id);
}

export interface ShareOptions extends ShareDetails {
	/** Leave out the Library Tasks that auto-filled Slots pick from (default: included). */
	noPool?: boolean;
}

/**
 * The habits inside one, at any depth, each before the habits inside it. Archived habits stay
 * out, and so does what sits inside them.
 */
export function insideHabits(accountId: string, id: string): InsideHabit[] {
	const active = listHabits(accountId).filter((h) => h.direction === 'build');
	const below = descendants(active, id);
	return flatten(active.filter((h) => below.has(h.id))).flatMap(({ node }) => {
		const form = node.parentId ? getHabitForm(accountId, node.id) : null;
		return form ? [{ id: node.id, parentId: node.parentId!, form }] : [];
	});
}

/**
 * The habit to share and the habits inside it, or null when it isn't the account's or has
 * nothing to give (a group with no habits inside: its days come from them).
 */
function shareTree(accountId: string, habitId: string): { habit: HabitForm; inside: InsideHabit[] } | null {
	const habit = getHabitForm(accountId, habitId);
	if (!habit) return null;
	const inside = insideHabits(accountId, habitId);
	if (isGroup(habit.schedule) && !inside.length) return null;
	return { habit, inside };
}

/** The template file for a habit and the habits inside it, or null (see shareTree). */
export function shareFile(accountId: string, habitId: string, opts: ShareOptions = {}): TemplateFile | null {
	const tree = shareTree(accountId, habitId);
	if (!tree) return null;
	const { habit, inside } = tree;
	// One that follows its routine travels with the routine's days as its own: the routine stays here.
	if (isFollow(habit.schedule)) {
		const parent = habit.parentId ? getHabitForm(accountId, habit.parentId) : null;
		habit.schedule = standaloneSchedule(parent?.schedule ?? null, habit.schedule, habit.startDate) as typeof habit.schedule;
	}
	habit.parentId = null;
	const all = [habit, ...inside.map((c) => c.form)];
	const tasks = new Map<string, TaskForm>();
	// A Task travels with the Library Tasks inside it.
	const add = (id: string) => {
		if (tasks.has(id)) return;
		const t = getTaskForm(accountId, id);
		if (!t) return;
		tasks.set(id, t);
		for (const p of t.parts) if (p.kind === 'task') add(p.taskId);
	};
	for (const h of all) for (const v of h.variants) for (const s of v.slots) if (s.taskId) add(s.taskId);
	// Without them, an auto-filled Slot finds nothing to pick on the other side.
	if (!opts.noPool) for (const h of all) for (const id of poolTaskIds(accountId, h)) add(id);
	return toTemplate(
		habit,
		tasks,
		{
			habits: new Map(listHabits(accountId).map((h) => [h.id, h.name])),
			identities: new Map(listIdentities(accountId).map((i) => [i.id, i.statement])),
			areas: new Map(listAreas(accountId).map((a) => [a.id, a.name]))
		},
		// The packs its Tasks' units and tags come from travel by name, for the other side to take.
		{ ...opts, packs: packsUsed(getPacks(accountId), [...tasks.values()]) },
		inside
	);
}

/** The Share page's form, as it posts it (JSON in one field), or undefined when it can't be read. */
export function shareField(f: FormData): unknown {
	try {
		return JSON.parse(String(f.get('share') ?? ''));
	} catch {
		return undefined;
	}
}

/**
 * The file the Share page asks for, to download or to keep in your Gallery: its form read and
 * checked on the server as on the page, and the file checked to import again.
 */
export function sharedFile(accountId: string, habitId: string, raw: unknown): { file: TemplateFile } | { status: 400 | 404 | 500; error: string } {
	const sc = shareContext(accountId, habitId);
	if (!sc) return { status: 404, error: 'Not found' };
	const parsed = shareForm.safeParse(raw);
	if (!parsed.success) return { status: 400, error: 'Could not read the share form.' };
	const form = normalize(shareRules, parsed.data, sc.ctx).form;
	const block = checkShare(form, sc.ctx).find((i) => i.severity === 'block');
	if (block) return { status: 400, error: block.reason };
	const file = shareFile(accountId, habitId, shareDetails(form, sc.ctx));
	// What goes out must import again.
	if (!file || !templateFile.safeParse(file).success) return { status: 500, error: 'Could not build the template.' };
	return { file };
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
	const tree = shareTree(accountId, habitId);
	if (!tree) return null;
	const { habit, inside } = tree;
	const all = [habit, ...inside.map((c) => c.form)];
	const metrics: ShareMetric[] = [];
	const withHowTo = new Set<string>();
	// A number question can set a field in any of the habits.
	for (const h of all)
		for (const v of h.variants)
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
					metrics.push({ id: m.id, task: t.name, name: m.name, unit: m.unit || (m.type === 'duration' ? 'min' : ''), target });
				}
			}
	const pool = [...new Set(all.flatMap((h) => poolTaskIds(accountId, h)))];
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
		note: all.some((h) => !!h.notes.trim()),
		howTo: withHowTo.size,
		metricIds: metrics.map((m) => m.id)
	};
	const poolNames = poolTasks.map((t) => t.name);
	/** The habits that go along, each with how deep it sits (1: directly inside). */
	const depth = new Map<string, number>([[habitId, 0]]);
	const insideNames = inside.map((c) => {
		const d = (depth.get(c.parentId) ?? 0) + 1;
		depth.set(c.id, d);
		return { name: c.form.name, depth: d };
	});
	return { habit, ctx, metrics, poolNames, inside: insideNames };
}
