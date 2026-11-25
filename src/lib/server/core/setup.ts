// Setting things up from outside the app: an assistant (or a script) creates and changes habits,
// Tasks and templates through the very checks and saves the editors use. A setup request is a list
// of changes. Without `apply` it is only a preview: the same code runs inside a transaction that is
// rolled back, so what the preview shows is exactly what Apply does. Apply runs every change in one
// transaction (all or nothing) and keeps how to undo it for a day (setup_undo).
//
// The shapes are the editors' own (src/lib/forms.ts) and the template file (src/lib/template.ts),
// so a field the app gains is settable here without new code. What this file adds is the part an
// assistant needs and a browser doesn't: names or short keys wherever the forms want ids.
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { habit, metric, slot, task, taskPart, undoSnapshot, variant } from '../db/schema';
import { defaultLevels, defaultTriggers, emptyCue, habitForm, type HabitForm, type TaskForm } from '$lib/forms';
import { DEFAULT_STREAK_RULE } from '$lib/engine/streak';
import { isPhases, tidyPhases } from '$lib/engine/schedule';
import { applyAnswers, fromTemplate, mapSchedule, templateFile, TEMPLATE_FORMAT, TEMPLATE_VERSION, type TemplateFile } from '$lib/template';
import { galleryItem, listGallery, PACK_OF } from '$lib/gallery';
import { packById } from '$lib/packs';
import { getHabitForm, listHabits, type ScheduleApplies } from '../repo/habits';
import { getTaskForm, setTaskArchived } from '../repo/tasks';
import { addTemplate, unadd } from '../repo/templates';
import { getSavedTemplate, listSavedTemplates, saveTemplate, deleteSavedTemplate } from '../repo/saved-templates';
import { areaFor, listAreas } from '../repo/areas';
import { identityFor, listIdentities } from '../repo/identities';
import { archiveHabit, unarchiveHabit } from '../habit-actions';
import { shareFile } from '../share';
import { restoreSnapshot, withSnapshot } from '../snapshot';
import { restoreTaskSnapshot, withTaskSnapshot } from '../task-snapshot';
import { takePack, undoPack, unitsWith, type PackUndo } from '../packs';
import { getPacks, getUnits, getViews } from '../settings';
import { changeViews } from '../views';
import { DEFAULT_VIEW, emptyState, FEATURES, GROUPS, HABIT_LINES, LAYOUTS, LINES, PAGE_LABEL, PAGES, SECTIONS, SORTS, STATS, TEMPLATES, WIDGETS, DONE_MODES, type ViewSettings } from '$lib/views';
import { trash } from '../trash';
import { userToday } from '../today';
import { ActionError, requireScope, type Actor } from './actor';
import { findHabit } from './day';
import { describe } from './read';
import { emit } from './events';
import { saveHabitChecked, saveTaskChecked, type Refused, type Saved } from './save';

// ---------- input ----------

const ref = z.string().trim().min(1).max(200);
const fields = z.record(z.string(), z.unknown());
/** Your own name for what a change makes, so a later change in the same request can point at it. */
const key = z.string().trim().min(1).max(64).optional();
const set = fields.describe('Only the fields that change, in the shape setup_read shows. A list is replaced whole.');

// The shapes inside (habit, task, template, set) are in setup_guide, so the tool stays short.
export const setupChange = z.discriminatedUnion('op', [
	z.object({ op: z.literal('add_habit'), key, habit: fields }),
	z.object({ op: z.literal('edit_habit'), habit: ref, set, scheduleApplies: z.enum(['today', 'past']).optional() }),
	z.object({ op: z.literal('add_task'), key, task: fields }),
	z.object({ op: z.literal('edit_task'), task: ref, set, units: z.record(z.string(), z.enum(['convert', 'relabel'])).optional() }),
	z.object({
		op: z.literal('add_template'),
		key,
		template: fields.optional(),
		from: z.string().trim().max(200).optional().describe('Or a template slug or id.'),
		answers: z.record(z.string(), z.union([z.number(), z.string().max(20), z.array(z.number().int().min(0).max(6)).max(7)])).optional(),
		reuse: z.boolean().optional(),
		remind: z.boolean().optional()
	}),
	z.object({ op: z.literal('archive'), habit: ref.optional(), task: ref.optional(), archived: z.boolean().optional() }),
	z.object({ op: z.literal('save_template'), habit: ref, name: z.string().trim().min(1).max(120).optional(), description: z.string().max(2000).optional() }),
	z.object({ op: z.literal('view'), change: fields })
]);
export type SetupChange = z.infer<typeof setupChange>;

export const setupInput = z.object({
	changes: z.array(setupChange).min(1).max(25),
	apply: z.boolean().optional().describe('Leave out to preview.'),
	check: z.string().max(80).optional().describe('With apply: the preview\'s check.')
});
export type SetupInput = z.infer<typeof setupInput>;

// ---------- references ----------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = z.string().uuid();
const isId = (v: unknown): v is string => typeof v === 'string' && uuid.safeParse(v).success;
const low = (s: unknown) => String(s ?? '').trim().toLowerCase();
const invalid = (msg: string, details?: unknown) => new ActionError('invalid', msg, details);

/**
 * Ids for one form's own new things (Variants, Slots, fields, options, parts): an id the thing
 * already has stays, anything else (a short key such as "A" or "push", or nothing) gets a new id,
 * the same one for the same key within the form, so the form can point at it.
 */
class Keys {
	private map = new Map<string, string>();
	constructor(private own: ReadonlySet<string> = new Set()) {}
	id(k: unknown): string {
		if (isId(k) && this.own.has(k)) return k;
		if (typeof k !== 'string' || !k.trim()) return randomUUID();
		let v = this.map.get(k);
		if (!v) this.map.set(k, (v = randomUUID()));
		return v;
	}
	has(k: string) {
		return this.map.has(k);
	}
	get(k: string) {
		return this.map.get(k);
	}
}

/** One setup request: what it made so far (by key), what it touched, and how to undo it. */
class Run {
	readonly made = { habits: new Map<string, string>(), tasks: new Map<string, string>() };
	readonly touched = { habits: new Set<string>(), tasks: new Set<string>(), views: false };
	readonly undo: UndoStep[] = [];
	constructor(
		readonly actor: Actor,
		readonly today: string
	) {}
	get accountId() {
		return this.actor.accountId;
	}

	habit(r: string): string {
		return this.made.habits.get(r.trim()) ?? findHabit(this.actor, r).id;
	}

	/** A Library Task by key (made earlier in this request), id, or name (any case). */
	task(r: string): string {
		const k = r.trim();
		const made = this.made.tasks.get(k);
		if (made) return made;
		const rows = db
			.select({ id: task.id, name: task.name, archived: task.archived })
			.from(task)
			.where(and(eq(task.accountId, this.accountId), isNull(task.parentTaskId)))
			.all();
		const byId = rows.find((t) => t.id === k);
		if (byId) return byId.id;
		const named = rows.filter((t) => low(t.name) === low(k));
		const live = named.filter((t) => !t.archived);
		if (live.length === 1) return live[0].id;
		if (!live.length && named.length === 1) return named[0].id;
		if (live.length > 1) throw new ActionError('conflict', `More than one Task is called “${k}”. Use its id.`, { ids: live.map((t) => t.id) });
		throw new ActionError('not_found', `No Task called “${k}” in the Library. Make it first with add_task (a key lets later changes point at it), or bring it in an add_template.`);
	}

	/** An Area by id or name; a name you don't have yet is added, as adding a template does. */
	area(r: unknown): string | null {
		if (r === null || r === undefined || r === '') return null;
		const s = String(r).trim();
		const all = listAreas(this.accountId);
		return all.find((a) => a.id === s)?.id ?? areaFor(this.accountId, s, true);
	}

	/** A field of a Task by id or name. */
	metric(taskId: string, r: string): string {
		const ms = db.select({ id: metric.id, name: metric.name }).from(metric).where(and(eq(metric.taskId, taskId), eq(metric.archived, false))).all();
		const hit = ms.find((m) => m.id === r) ?? ms.find((m) => low(m.name) === low(r));
		if (hit) return hit.id;
		const name = db.select({ name: task.name }).from(task).where(eq(task.id, taskId)).get()?.name ?? taskId;
		throw invalid(`“${name}” has no field “${r}”. Its fields: ${ms.map((m) => m.name).join(', ') || 'none'}.`);
	}

	/** Targets keyed by field id or name, keyed by id. */
	goals(taskId: string | null, rec: unknown): unknown {
		if (!taskId || !isObj(rec)) return rec;
		return Object.fromEntries(Object.entries(rec).map(([k, v]) => [this.metric(taskId, k), v]));
	}
}

/** "today", nothing, or a date. */
const day = (v: unknown, today: string) => (v === undefined || v === null || v === '' || v === 'today' ? today : v);

/** Options (a choice field's, or a break habit's feelings): a list of names or {id, name}. */
function options(list: unknown, before: { id: string; name: string }[], keys: Keys): unknown {
	if (!Array.isArray(list)) return list;
	const own = new Set(before.map((o) => o.id));
	return list.map((o) => {
		const x = typeof o === 'string' ? { name: o } : isObj(o) ? o : {};
		const same = isId(x.id) && own.has(x.id) ? x.id : before.find((b) => low(b.name) === low(x.name))?.id;
		return { ...x, id: same ?? keys.id(x.id ?? `option:${low(x.name)}`) };
	});
}

/** A habit form with names and keys turned into ids (see setup_guide topic "habit"). */
function resolveHabit(run: Run, raw: Obj, id: string | null): Obj {
	const f: Obj = { ...raw };
	// What this habit already has: only its own Variants and Slots keep their ids.
	const before = id ? getHabitForm(run.accountId, id) : null;
	const ownVariants = id ? db.select({ id: variant.id, name: variant.name, archived: variant.archived }).from(variant).where(eq(variant.habitId, id)).all() : [];
	const ownSlots = ownVariants.length
		? db.select({ id: slot.id }).from(slot).where(inArray(slot.variantId, ownVariants.map((v) => v.id))).all().map((s) => s.id)
		: [];
	const vKeys = new Keys(new Set(ownVariants.map((v) => v.id)));
	const sKeys = new Keys(new Set(ownSlots));
	/** Each Variant ref the schedule may use: its key or id, and its name. */
	const variantRef = new Map<string, string>();
	if (Array.isArray(f.variants)) {
		f.variants = f.variants.map((v0, i) => {
			const v = isObj(v0) ? v0 : {};
			// Named like one it has: the same Variant, so its past logs stay with it.
			const same = !isId(v.id) || !vKeys.has(String(v.id)) ? ownVariants.find((o) => !o.archived && low(o.name) === low(v.name))?.id : undefined;
			const vid = isId(v.id) && ownVariants.some((o) => o.id === v.id) ? v.id : (same ?? vKeys.id(v.id ?? `variant:${i}:${low(v.name)}`));
			if (typeof v.id === 'string') variantRef.set(v.id, vid);
			variantRef.set(vid, vid);
			if (typeof v.name === 'string') variantRef.set(low(v.name), vid);
			const slots = Array.isArray(v.slots)
				? v.slots.map((s0) => {
						const s = isObj(s0) ? s0 : {};
						const taskId = typeof s.taskId === 'string' && s.taskId ? run.task(s.taskId) : null;
						return {
							sets: null,
							fillRule: null,
							...s,
							id: sKeys.id(s.id),
							taskId,
							targets: run.goals(taskId, s.targets),
							minTargets: run.goals(taskId, s.minTargets),
							stretchTargets: run.goals(taskId, s.stretchTargets)
						};
					})
				: [];
			return { ...v, id: vid, name: v.name ?? `Variant ${i + 1}`, slots };
		});
	}
	const variants = (Array.isArray(f.variants) ? f.variants : []) as { id: string; name: string }[];
	const own = (r: string) => {
		const hit = variantRef.get(r) ?? variantRef.get(low(r));
		if (hit) return hit;
		throw invalid(`The schedule names a Variant “${r}” this habit doesn't have. Its Variants: ${variants.map((v) => v.name).join(', ') || 'none'}.`);
	};
	if (f.parentId !== undefined) f.parentId = typeof f.parentId === 'string' && f.parentId ? run.habit(f.parentId) : null;
	if (isObj(f.schedule)) {
		const s: Obj = { ...f.schedule };
		// With one Variant, the schedule may leave it out.
		const only = variants.length === 1 ? variants[0].id : undefined;
		const fill = (x: Obj) => {
			if ((x.kind === 'frequency' || x.kind === 'interval' || x.kind === 'follow') && !x.variantId && only) x.variantId = only;
			if (x.kind === 'interval' || x.kind === 'rotation' || x.kind === 'phases') x.start = day(x.start, run.today);
			if (x.kind === 'weekly' && Array.isArray(x.days) && only) x.days = Object.fromEntries((x.days as unknown[]).map((d) => [String(d), only]));
			if (x.kind === 'rotation') {
				x.onMiss ??= 'wait';
				x.weekdays ??= [];
				if (Array.isArray(x.order)) x.order = x.order.map((o) => (typeof o === 'string' ? { variantId: o, restDays: 0 } : isObj(o) ? { restDays: 0, ...o } : o));
			}
			return x;
		};
		fill(s);
		if (s.kind === 'phases' && Array.isArray(s.phases))
			s.phases = s.phases.map((p) => (isObj(p) && isObj(p.schedule) ? { unit: 'week', ...p, schedule: fill({ ...p.schedule }) } : p));
		// A habit that follows its routine names the routine's Variants too, by id or name.
		const parentId = typeof f.parentId === 'string' ? f.parentId : null;
		const theirs = parentId ? db.select({ id: variant.id, name: variant.name }).from(variant).where(and(eq(variant.habitId, parentId), eq(variant.archived, false))).all() : [];
		const routine = (r: string) => {
			const hit = theirs.find((v) => v.id === r) ?? theirs.find((v) => low(v.name) === low(r));
			if (hit) return hit.id;
			throw invalid(`The routine has no Variant “${r}”. Its Variants: ${theirs.map((v) => v.name).join(', ') || 'none'}.`);
		};
		try {
			const mapped = mapSchedule(s as never, own, routine) as unknown as Obj;
			f.schedule = isPhases(mapped as never) ? tidyPhases(mapped as never) : mapped;
		} catch (e) {
			if (e instanceof ActionError) throw e;
			throw invalid('That schedule can\'t be read. See setup_guide topic "schedule".');
		}
	}
	f.startDate = day(f.startDate, run.today);
	if (f.areaId !== undefined) f.areaId = run.area(f.areaId);
	if (isObj(f.cue) && typeof f.cue.afterHabitId === 'string' && f.cue.afterHabitId) f.cue = { ...f.cue, afterHabitId: run.habit(f.cue.afterHabitId) };
	if (isObj(f.ifThen) && typeof f.ifThen.habitId === 'string' && f.ifThen.habitId) f.ifThen = { ...f.ifThen, habitId: run.habit(f.ifThen.habitId) };
	if (isObj(f.limit)) f.limit = { taper: null, ...f.limit, start: day(f.limit.start, run.today) };
	// Identity statements by id or by their words (a new statement is added).
	if (Array.isArray(f.identityIds)) {
		const mine = listIdentities(run.accountId);
		f.identityIds = f.identityIds.map((x) => (isId(x) && mine.some((i) => i.id === x) ? x : identityFor(run.accountId, String(x))));
	}
	if (f.triggers !== undefined) f.triggers = options(f.triggers, before?.triggers ?? [], new Keys());
	return f;
}

/** A Task form with names and keys turned into ids (see setup_guide topic "task"). */
function resolveTask(run: Run, raw: Obj, id: string | null): Obj {
	const f: Obj = { ...raw };
	const before = id ? getTaskForm(run.accountId, id) : null;
	const ownMetrics = id ? db.select({ id: metric.id, name: metric.name, archived: metric.archived }).from(metric).where(eq(metric.taskId, id)).all() : [];
	const ownParts = id ? db.select({ id: taskPart.id }).from(taskPart).where(eq(taskPart.taskId, id)).all().map((p) => p.id) : [];
	const mKeys = new Keys(new Set(ownMetrics.map((m) => m.id)));
	const pKeys = new Keys(new Set(ownParts));
	if (Array.isArray(f.metrics)) {
		f.metrics = f.metrics.map((m0, i) => {
			const m = isObj(m0) ? m0 : {};
			const known = isId(m.id) && ownMetrics.some((o) => o.id === m.id) ? (m.id as string) : ownMetrics.find((o) => !o.archived && low(o.name) === low(m.name))?.id;
			const mid = known ?? mKeys.id(m.id ?? `field:${i}:${low(m.name)}`);
			const was = before?.metrics.find((x) => x.id === mid);
			const choices = options(m.choices, was?.choices ?? [], new Keys()) as { id: string; name: string }[] | undefined;
			// A choice's score by option id or name.
			const scores = isObj(m.scores) && Array.isArray(choices)
				? Object.fromEntries(Object.entries(m.scores).map(([k, v]) => [choices.find((c) => c.id === k || low(c.name) === low(k))?.id ?? k, v]))
				: m.scores;
			return { repeats: false, ...m, id: mid, ...(choices ? { choices } : {}), ...(scores !== undefined ? { scores } : {}) };
		});
	}
	if (Array.isArray(f.parts)) {
		f.parts = f.parts.map((p0) => {
			const p = typeof p0 === 'string' ? { kind: 'step', name: p0 } : isObj(p0) ? p0 : {};
			const kind = p.kind ?? (p.taskId || p.task ? 'task' : 'step');
			if (kind === 'step') return { ...p, kind, id: pKeys.id(p.id ?? `step:${low(p.name)}`) };
			const taskId = run.task(String(p.taskId ?? p.task ?? ''));
			const { task: _t, ...rest } = p;
			void _t;
			return {
				sets: null,
				...rest,
				kind,
				id: pKeys.id(p.id),
				taskId,
				targets: run.goals(taskId, p.targets) ?? {},
				minTargets: run.goals(taskId, p.minTargets) ?? {},
				stretchTargets: run.goals(taskId, p.stretchTargets) ?? {}
			};
		});
	}
	if (Array.isArray(f.tags)) f.tags = f.tags.map((t) => (typeof t === 'string' ? { name: t, level: 1 } : t));
	if (f.areaId !== undefined) f.areaId = run.area(f.areaId);
	return f;
}

/**
 * A template as an assistant writes it, made exact: keys may be left out (a name is the key),
 * a Slot or part may name its Task, targets may be keyed by field name, field keys need only be
 * unique within their Task, and a schedule may name Variants. The file itself keeps one key per
 * field across the file, so field keys are made unique here and every target follows.
 */
export function tidyTemplate(raw: Obj): Obj {
	const t: Obj = { ...raw };
	const tasks = (Array.isArray(t.tasks) ? t.tasks : []).filter(isObj).map((x) => ({ ...x }));
	const taskKey = (x: Obj) => String(x.key ?? x.name ?? '');
	const used = new Set<string>();
	/** Per Task key: its fields' refs (key or name) to their key in the file. */
	const fieldsOf = new Map<string, Map<string, string>>();
	/** A field key as it was -> every file key it became (for questions). */
	const byOldKey = new Map<string, string[]>();
	for (const task of tasks) {
		task.key = taskKey(task);
		const refs = new Map<string, string>();
		task.metrics = (Array.isArray(task.metrics) ? task.metrics : []).filter(isObj).map((m) => {
			const old = String(m.key ?? m.name ?? '');
			let k = old;
			for (let n = 2; used.has(k); n++) k = `${task.key}.${old}${n > 2 ? n : ''}`;
			used.add(k);
			refs.set(old, k);
			if (typeof m.name === 'string') refs.set(low(m.name), k);
			byOldKey.set(old, [...(byOldKey.get(old) ?? []), k]);
			return { ...m, key: k };
		});
		fieldsOf.set(String(task.key), refs);
	}
	const taskRef = (r: unknown) => {
		const s = String(r ?? '');
		return tasks.find((x) => x.key === s)?.key ?? tasks.find((x) => low(x.name) === low(s))?.key ?? s;
	};
	const goals = (taskK: unknown, rec: unknown) => {
		const refs = fieldsOf.get(String(taskK));
		if (!refs || !isObj(rec)) return rec;
		return Object.fromEntries(Object.entries(rec).map(([k, v]) => [refs.get(k) ?? refs.get(low(k)) ?? k, v]));
	};
	const withGoals = (x: Obj, taskK: unknown) => ({ ...x, targets: goals(taskK, x.targets), minTargets: goals(taskK, x.minTargets), stretchTargets: goals(taskK, x.stretchTargets) });
	for (const task of tasks)
		if (Array.isArray(task.parts))
			task.parts = task.parts.map((p) => {
				if (typeof p === 'string') return { step: p };
				if (!isObj(p) || p.step !== undefined) return p;
				const k = taskRef(p.task);
				return withGoals({ ...p, task: k }, k);
			});
	/** Variant refs (key or name) to keys, per habit of the file. */
	const variantKeys = new Map<string, Map<string, string>>();
	const tidyHabit = (h0: unknown, self: string, parent: string | null): unknown => {
		if (!isObj(h0)) return h0;
		const h: Obj = { ...h0 };
		const refs = new Map<string, string>();
		h.variants = (Array.isArray(h.variants) ? h.variants : []).filter(isObj).map((v, i) => {
			const k = String(v.key ?? v.name ?? `v${i + 1}`);
			refs.set(k, k);
			if (typeof v.name === 'string') refs.set(low(v.name), k);
			const slots = (Array.isArray(v.slots) ? v.slots : []).filter(isObj).map((s) => {
				const tk = s.task === null || s.task === undefined ? null : taskRef(s.task);
				return withGoals({ fillRule: null, ...s, task: tk }, tk);
			});
			return { ...v, key: k, name: v.name ?? k, slots };
		});
		variantKeys.set(self, refs);
		const only = (h.variants as Obj[]).length === 1 ? String((h.variants as Obj[])[0].key) : undefined;
		if (isObj(h.schedule)) {
			const s: Obj = { ...h.schedule };
			const fill = (x: Obj) => {
				if ((x.kind === 'frequency' || x.kind === 'interval' || x.kind === 'follow') && !x.variantId && only) x.variantId = only;
				if (x.kind === 'weekly' && Array.isArray(x.days) && only) x.days = Object.fromEntries((x.days as unknown[]).map((d) => [String(d), only]));
				if (x.kind === 'interval' || x.kind === 'rotation' || x.kind === 'phases') x.start = x.start ?? '2000-01-03';
				if (x.kind === 'rotation') {
					x.onMiss ??= 'wait';
					x.weekdays ??= [];
					if (Array.isArray(x.order)) x.order = x.order.map((o) => (typeof o === 'string' ? { variantId: o, restDays: 0 } : isObj(o) ? { restDays: 0, ...o } : o));
				}
				return x;
			};
			fill(s);
			if (s.kind === 'phases' && Array.isArray(s.phases)) s.phases = s.phases.map((p) => (isObj(p) && isObj(p.schedule) ? { unit: 'week', ...p, schedule: fill({ ...p.schedule }) } : p));
			const theirs = variantKeys.get(parent ?? '') ?? new Map<string, string>();
			try {
				h.schedule = mapSchedule(s as never, (r) => refs.get(r) ?? refs.get(low(r)) ?? r, (r) => theirs.get(r) ?? theirs.get(low(r)) ?? r);
			} catch {
				// Left as it is: the file's own check says what is wrong with it.
			}
		}
		return h;
	};
	t.habit = tidyHabit(t.habit, '', null);
	if (Array.isArray(t.children))
		t.children = t.children.filter(isObj).map((c, i) => {
			const k = String(c.key ?? c.name ?? `h${i + 1}`);
			const parent = c.parent === undefined || c.parent === null ? null : String(c.parent);
			return { ...(tidyHabit(c, k, parent ?? '') as Obj), key: k, parent };
		});
	if (Array.isArray(t.questions))
		t.questions = t.questions.map((q) => (isObj(q) && Array.isArray(q.metrics) ? { ...q, metrics: q.metrics.flatMap((m) => byOldKey.get(String(m)) ?? [String(m)]) } : q));
	t.tasks = tasks;
	return t;
}

/** Zod's first few problems, with where they are. */
function zodError(what: string, e: z.ZodError): ActionError {
	const issues = e.issues.slice(0, 3).map((i) => `${i.path.join('.') || what}: ${i.message}`);
	return invalid(`${what}: ${issues.join('; ')}`, e.issues.slice(0, 5));
}

// ---------- saving, with the editors' checks ----------

/** The editor's Save (core/save.ts), with a refusal as an error that names what was refused. */
function saved(what: string, raw: Obj, r: Saved | Refused): Saved {
	if ('id' in r) return r;
	if (r.notFound) throw new ActionError('not_found', `No such ${what.toLowerCase()}.`);
	if (r.zod) throw zodError(`${what} “${raw.name ?? ''}”`, r.zod);
	throw invalid(`${what} “${raw.name ?? ''}”: ${r.error}.`);
}
const saveHabitForm = (run: Run, id: string | null, raw: Obj, applies: ScheduleApplies) => saved('Habit', raw, saveHabitChecked(run.accountId, id, raw, run.today, applies));
function saveTaskForm(run: Run, id: string | null, raw: Obj, units: Record<string, 'convert' | 'relabel'> = {}) {
	// Unit choices by field id or name.
	const metrics = (Array.isArray(raw.metrics) ? raw.metrics : []) as { id: string; name: string }[];
	const choices = Object.fromEntries(Object.entries(units).map(([k, v]) => [metrics.find((m) => m.id === k || low(m.name) === low(k))?.id ?? k, v]));
	const r = saveTaskChecked(run.actor, id, raw, choices);
	if ('error' in r && /^Choose what happens/.test(r.error)) r.error += '. Pass units: {"<field>": "convert" or "relabel"} on edit_task';
	return saved('Task', raw, r);
}

// ---------- the changes ----------

const blankHabit = (today: string): HabitForm => ({
	name: '',
	direction: 'build',
	notes: '',
	startDate: today,
	variants: [],
	schedule: null,
	parentId: null,
	cue: emptyCue(),
	streakRule: DEFAULT_STREAK_RULE,
	minimumCounts: true,
	levels: defaultLevels(),
	quickDone: false,
	remind: false,
	reminder: null,
	identityIds: [],
	ifThen: { when: '', then: '', habitId: null },
	triggers: defaultTriggers(),
	reframe: '',
	bundle: { reward: '', strict: false },
	prep: [],
	reward: { celebrate: false, message: '', jar: null },
	cost: null,
	limit: null,
	progression: null,
	areaId: null,
	unlogged: 'missed'
});

const blankTask = (): Partial<TaskForm> => ({ notes: '', restTimerEnabled: false, restTimerSeconds: 90, tags: [], metrics: [], parts: [], areaId: null, collectionIds: [] });

/** How to undo one change. */
type UndoStep =
	| { k: 'habit'; snapshot: string }
	| { k: 'task'; snapshot: string }
	| { k: 'added'; made: { habits: string[]; tasks: string[] } }
	| { k: 'archive'; t: 'habit' | 'task'; id: string; archived: boolean }
	| { k: 'pack'; undo: PackUndo }
	| { k: 'saved'; id: string }
	| { k: 'views'; before: ViewSettings; after: ViewSettings };

export interface ChangeResult {
	op: SetupChange['op'];
	/** One line, in the user's words. */
	summary: string;
	habitId?: string;
	taskId?: string;
	/** Top-level fields an edit changed. */
	changed?: string[];
	warnings?: string[];
}

type Op<K extends SetupChange['op']> = (run: Run, c: Extract<SetupChange, { op: K }>) => ChangeResult;

/** The top-level fields whose value differs. */
const changedFields = (a: object | null, b: object | null) =>
	[...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter(
		(k) => JSON.stringify((a as Obj | null)?.[k] ?? null) !== JSON.stringify((b as Obj | null)?.[k] ?? null)
	);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A ready-made template (with the starter pack it brings) or a saved one. */
function templateFrom(run: Run, from: string): { tpl: TemplateFile; pack?: string } {
	const pack = PACK_OF[from] && !getPacks(run.accountId).includes(PACK_OF[from]) ? packById(PACK_OF[from]) : undefined;
	const builtIn = galleryItem(from, pack ? unitsWith(run.accountId, pack.id) : getUnits(run.accountId));
	if (builtIn) return { tpl: builtIn.template, pack: pack?.id };
	const saved = getSavedTemplate(run.accountId, from);
	if (saved) return { tpl: saved.template };
	throw new ActionError('not_found', `No template “${from}”. setup_read with ref "templates" lists them.`);
}

/** A view change with names where it wants ids: views by name, Areas and habits by name. */
function resolveView(run: Run, raw: Obj): Obj {
	const c: Obj = { ...raw };
	const v = getViews(run.accountId);
	const viewId = (r: unknown, page?: unknown) => {
		const s = String(r ?? '');
		if (s === DEFAULT_VIEW || s === 'last') return s;
		const mine = v.saved.filter((x) => !page || x.page === page);
		return mine.find((x) => x.id === s)?.id ?? mine.find((x) => low(x.name) === low(s))?.id ?? s;
	};
	if (typeof c.view === 'string') c.view = viewId(c.view, c.page);
	if (c.op === 'delete' && typeof c.id === 'string') c.id = viewId(c.id);
	if (c.op === 'open' && typeof c.value === 'string') c.value = viewId(c.value, c.page);
	if (isObj(c.state)) {
		const st: Obj = { ...emptyState(), ...c.state };
		const areas = listAreas(run.accountId);
		if (Array.isArray(st.areas)) st.areas = st.areas.map((a) => areas.find((x) => x.id === a || low(x.name) === low(a))?.id ?? a);
		if (typeof st.habit === 'string' && st.habit) st.habit = run.habit(st.habit);
		if (typeof st.identity === 'string' && st.identity) st.identity = listIdentities(run.accountId).find((i) => i.id === st.identity || low(i.statement) === low(st.identity))?.id ?? st.identity;
		c.state = st;
	}
	return c;
}

const viewName = (v: ViewSettings, id: string | undefined) => (!id || id === DEFAULT_VIEW ? 'Default' : (v.saved.find((x) => x.id === id)?.name ?? id));

const OPS: { [K in SetupChange['op']]: Op<K> } = {
	view: (run, c) => {
		const before = getViews(run.accountId);
		const change = resolveView(run, c.change);
		const r = changeViews(run.accountId, change);
		run.touched.views = true;
		if (JSON.stringify(before) !== JSON.stringify(r.views)) run.undo.push({ k: 'views', before, after: r.views });
		const page = typeof change.page === 'string' && change.page in PAGE_LABEL ? PAGE_LABEL[change.page as keyof typeof PAGE_LABEL] : '';
		const summary: Record<string, () => string> = {
			save: () => `Add the view “${change.name}” to ${page}`,
			update: () => `Change the view “${viewName(before, (change.view as string) ?? before.active[change.page as string])}” on ${page}`,
			select: () => `Put ${page} on the view “${viewName(before, change.view as string)}”`,
			delete: () => `Delete the view “${viewName(before, change.id as string)}”`,
			open: () => `${page} opens with ${change.value === 'last' ? 'the view it was on last' : `the view “${viewName(before, change.value as string)}”`}`,
			patch: () => `Change the layout: ${Object.keys(change).filter((k) => k !== 'op').join(', ')}`,
			template: () => `Switch to the view template “${TEMPLATES.find((t) => t.id === change.id)?.name ?? change.id}”`,
			restore: () => 'Put the views back as they were'
		};
		return { op: c.op, summary: summary[String(change.op)]?.() ?? 'Change the views', warnings: r.warnings };
	},

	add_habit: (run, c) => {
		const start = blankHabit(run.today);
		const raw = { ...start, ...c.habit } as Obj;
		// A build habit with nothing said about Variants gets one, named after it.
		if (raw.direction !== 'break' && (!Array.isArray(raw.variants) || !raw.variants.length) && !(isObj(raw.schedule) && raw.schedule.kind === 'group'))
			raw.variants = [{ id: 'main', name: String(raw.name ?? 'Main'), slots: [] }];
		const { id, warnings } = saveHabitForm(run, null, resolveHabit(run, raw, null), 'today');
		if (c.key) run.made.habits.set(c.key, id);
		run.touched.habits.add(id);
		run.undo.push({ k: 'added', made: { habits: [id], tasks: [] } });
		return { op: c.op, summary: `Add habit “${raw.name}”`, habitId: id, warnings };
	},
	edit_habit: (run, c) => {
		const id = run.habit(c.habit);
		const before = getHabitForm(run.accountId, id);
		if (!before) throw new ActionError('not_found', `No habit “${c.habit}”.`);
		const raw = resolveHabit(run, { ...before, ...c.set }, id);
		const { result, undo } = withSnapshot(run.accountId, id, () => saveHabitForm(run, id, raw, c.scheduleApplies ?? 'today'));
		run.undo.push({ k: 'habit', snapshot: undo });
		run.touched.habits.add(id);
		const changed = changedFields(before, getHabitForm(run.accountId, id));
		return {
			op: c.op,
			summary: changed.length ? `Change habit “${before.name}”: ${changed.join(', ')}` : `Habit “${before.name}”: nothing changes`,
			habitId: id,
			changed,
			warnings: result.warnings
		};
	},
	add_task: (run, c) => {
		const raw = { ...blankTask(), ...c.task } as Obj;
		const { id, warnings } = saveTaskForm(run, null, resolveTask(run, raw, null));
		if (c.key) run.made.tasks.set(c.key, id);
		run.touched.tasks.add(id);
		run.undo.push({ k: 'added', made: { habits: [], tasks: [id] } });
		return { op: c.op, summary: `Add Task “${raw.name}” to the Library`, taskId: id, warnings };
	},
	edit_task: (run, c) => {
		const id = run.task(c.task);
		const before = getTaskForm(run.accountId, id);
		if (!before) throw new ActionError('not_found', `No Task “${c.task}”.`);
		const raw = resolveTask(run, { ...before, ...c.set }, id);
		const { result, undo } = withTaskSnapshot(run.accountId, id, () => saveTaskForm(run, id, raw, c.units));
		run.undo.push({ k: 'task', snapshot: undo });
		run.touched.tasks.add(id);
		const changed = changedFields(before, getTaskForm(run.accountId, id));
		return {
			op: c.op,
			summary: changed.length ? `Change Task “${before.name}”: ${changed.join(', ')}` : `Task “${before.name}”: nothing changes`,
			taskId: id,
			changed,
			warnings: result.warnings
		};
	},
	add_template: (run, c) => {
		let tpl: TemplateFile;
		let packId: string | undefined;
		if (c.from) ({ tpl, pack: packId } = templateFrom(run, c.from));
		else if (c.template) {
			const t = c.template;
			const name = isObj(t.habit) && typeof t.habit.name === 'string' ? t.habit.name : 'Template';
			const p = templateFile.safeParse(tidyTemplate({ format: TEMPLATE_FORMAT, version: TEMPLATE_VERSION, name, tasks: [], ...t }));
			if (!p.success) throw zodError('Template', p.error);
			tpl = p.data;
		} else throw invalid('add_template needs a template, or from: a template\'s slug or id.');
		// Say which habit and field is wrong, before adding says only that something is.
		const made = fromTemplate(applyAnswers(tpl, c.answers ?? {}), run.today);
		for (const h of [made.habit, ...made.children.map((x) => x.habit)]) {
			const p = habitForm.safeParse(h);
			if (!p.success) throw zodError(`Template habit “${h.name}”`, p.error);
		}
		// A ready-made template brings its starter pack (units, groupings, measures) first, as the Gallery does.
		if (packId) {
			const taken = takePack(run.accountId, packId);
			if ('undo' in taken) run.undo.push({ k: 'pack', undo: taken.undo });
		}
		const r = addTemplate(run.accountId, tpl, { today: run.today, answers: c.answers, reuse: c.reuse ?? true, remind: c.remind });
		if ('error' in r) throw invalid(r.error);
		if (c.key) run.made.habits.set(c.key, r.habitId);
		for (const h of r.made.habits) run.touched.habits.add(h);
		for (const t of r.made.tasks) run.touched.tasks.add(t);
		run.undo.push({ k: 'added', made: r.made });
		const parts = [plural(r.created, 'new Task'), r.reused ? `${r.reused} from your Library` : '', r.inside ? plural(r.inside, 'habit') + ' inside' : ''].filter(Boolean);
		return { op: c.op, summary: `Add “${r.name}” (${parts.join(', ')})`, habitId: r.habitId };
	},
	archive: (run, c) => {
		const archived = c.archived ?? true;
		if (!c.habit === !c.task) throw invalid('archive takes a habit or a task.');
		if (c.habit) {
			const id = run.habit(c.habit);
			const h = db.select({ name: habit.name, archived: habit.archived }).from(habit).where(eq(habit.id, id)).get()!;
			if (h.archived !== archived) {
				if (archived) archiveHabit(run.accountId, id, run.today);
				else unarchiveHabit(run.accountId, id, run.today);
				run.undo.push({ k: 'archive', t: 'habit', id, archived });
			}
			run.touched.habits.add(id);
			return { op: c.op, summary: h.archived === archived ? `Habit “${h.name}” is already ${archived ? 'archived' : 'active'}` : `${archived ? 'Archive' : 'Bring back'} habit “${h.name}”`, habitId: id };
		}
		const id = run.task(c.task!);
		const t = db.select({ name: task.name, archived: task.archived }).from(task).where(eq(task.id, id)).get()!;
		if (t.archived !== archived) {
			setTaskArchived(run.accountId, id, archived);
			run.undo.push({ k: 'archive', t: 'task', id, archived });
		}
		run.touched.tasks.add(id);
		return { op: c.op, summary: t.archived === archived ? `Task “${t.name}” is already ${archived ? 'archived' : 'active'}` : `${archived ? 'Archive' : 'Bring back'} Task “${t.name}”`, taskId: id };
	},
	save_template: (run, c) => {
		const id = run.habit(c.habit);
		const file = shareFile(run.accountId, id, { name: c.name, description: c.description });
		if (!file) throw new ActionError('not_found', `No habit “${c.habit}”.`);
		const saved = saveTemplate(run.accountId, file);
		run.undo.push({ k: 'saved', id: saved });
		return { op: c.op, summary: `Keep “${file.name}” in My templates (Gallery), with ${plural(file.tasks.length, 'Task')}${file.children.length ? ` and ${plural(file.children.length, 'habit')} inside` : ''}`, habitId: id };
	}
};

// ---------- preview and apply ----------

/** Thrown inside a transaction to roll it back while keeping what it found. */
class Rollback<T> extends Error {
	constructor(public value: T) {
		super('rollback');
	}
}
function dryRun<T>(fn: () => T): T {
	try {
		db.transaction(() => {
			throw new Rollback(fn());
		});
	} catch (e) {
		if (e instanceof Rollback) return e.value as T;
		throw e;
	}
	throw new Error('unreachable');
}

type Described = ReturnType<typeof describe>;

/** What describe leaves out of a habit but a person checks before saying yes: only what is set. */
function settingsOf(accountId: string, id: string, notes = false) {
	const f = getHabitForm(accountId, id);
	if (!f) return {};
	const habitName = (x: string | null) => (x ? (db.select({ name: habit.name }).from(habit).where(eq(habit.id, x)).get()?.name ?? null) : null);
	const cue = [f.cue.time, f.cue.range, f.cue.place && `at ${f.cue.place}`, (habitName(f.cue.afterHabitId) ?? f.cue.afterText) && `after ${habitName(f.cue.afterHabitId) ?? f.cue.afterText}`].filter(Boolean).join(' · ');
	const identities = listIdentities(accountId).filter((i) => f.identityIds.includes(i.id)).map((i) => i.statement);
	return Object.fromEntries(
		Object.entries({
			cue: cue || null,
			levels: f.levels.enabled ? { minimum: f.levels.minimum, target: f.levels.target, stretch: f.levels.stretch } : null,
			reminder: f.remind ? (f.reminder?.time ?? 'on') : null,
			quickDone: f.quickDone || null,
			unlogged: f.unlogged === 'ignore' ? 'ignored (not counted as missed)' : null,
			identities: identities.length ? identities : null,
			ifThen: f.direction === 'break' && (f.ifThen.when || f.ifThen.then) ? `When ${f.ifThen.when}, then ${f.ifThen.then || habitName(f.ifThen.habitId)}` : null,
			limit: f.limit,
			cost: f.cost,
			progression: f.progression,
			prep: f.prep.length ? f.prep : null,
			notes: notes && f.notes ? `${f.notes.slice(0, 200)}${f.notes.length > 200 ? '…' : ''}` : null
		}).filter(([, v]) => v !== null && v !== undefined)
	);
}

/** The views as a person reads them: each page's views (only what differs from a blank view) and the layout. */
export function viewsOf(v: ViewSettings) {
	const blank = emptyState() as Record<string, unknown>;
	const set = (st: Record<string, unknown>) => Object.fromEntries(Object.entries(st).filter(([k, x]) => JSON.stringify(x) !== JSON.stringify(blank[k])));
	return {
		template: v.template,
		startPage: v.startPage,
		pages: Object.fromEntries(
			PAGES.map((p) => [
				p,
				{
					on: viewName(v, v.active[p] ?? DEFAULT_VIEW),
					views: [{ name: 'Default', id: DEFAULT_VIEW, state: set((v.defaults[p] ?? {}) as Record<string, unknown>) }, ...v.saved.filter((x) => x.page === p).map((x) => ({ name: x.name, id: x.id, state: set(x.state) }))]
				}
			])
		),
		today: { ...v.today, order: `${v.today.order.length} habits in My order` },
		habits: v.habits,
		history: v.history,
		hidden: v.hidden
	};
}

/** The touched habits and Tasks as describe shows them (without the running totals), with their settings. */
function slice(d: Described, touched: Run['touched'], actor: Actor) {
	return {
		habits: d.habits.filter((h) => touched.habits.has(h.id)).map(({ totals: _t, ...h }) => (void _t, { ...h, settings: settingsOf(actor.accountId, h.id, actor.scopes.has('notes')) })),
		tasks: d.tasks.filter((t) => touched.tasks.has(t.id))
	};
}

const checkOf = (accountId: string, changes: unknown, before: unknown) =>
	createHash('sha256').update(JSON.stringify([accountId, changes, before])).digest('base64url').slice(0, 16);

const KEEP_MS = 24 * 3600_000;

/** Preview a setup request, or apply it with `apply: true`. */
export function runSetup(actor: Actor, input: SetupInput) {
	requireScope(actor, 'edit');
	requireScope(actor, 'read');
	if (actor.habitIds) throw new ActionError('forbidden', 'Setting up needs a key that can see every habit. This one is limited to some.');
	const today = userToday(actor.accountId, actor.tz);
	const exec = () => {
		const start = describe(actor);
		const viewsBefore = getViews(actor.accountId);
		const run = new Run(actor, today);
		/** As things are before: read now, cut to what the changes touch once they are known. */
		const settingsBefore = new Map(listHabits(actor.accountId, { archived: true }).map((h) => [h.id, settingsOf(actor.accountId, h.id, actor.scopes.has('notes'))]));
		const changes: ChangeResult[] = [];
		input.changes.forEach((c, i) => {
			try {
				changes.push((OPS[c.op] as Op<typeof c.op>)(run, c as never));
			} catch (e) {
				if (e instanceof ActionError) throw new ActionError(e.code, `Change ${i + 1} (${c.op}): ${e.message}`, e.details);
				throw e;
			}
		});
		const before = {
			habits: start.habits.filter((h) => run.touched.habits.has(h.id)).map(({ totals: _t, ...h }) => (void _t, { ...h, settings: settingsBefore.get(h.id) ?? {} })),
			tasks: start.tasks.filter((t) => run.touched.tasks.has(t.id)),
			...(run.touched.views ? { views: viewsOf(viewsBefore) } : {})
		};
		const after = { ...slice(describe(actor), run.touched, actor), ...(run.touched.views ? { views: viewsOf(getViews(actor.accountId)) } : {}) };
		return { run, changes, before, after, check: checkOf(actor.accountId, input.changes, before) };
	};

	if (!input.apply) {
		const r = dryRun(exec);
		return {
			preview: true,
			check: r.check,
			summary: r.changes.map((c) => c.summary),
			changes: r.changes,
			before: r.before,
			after: r.after,
			next: 'Nothing is saved yet. Show the user what changes, in plain words, and ask. To make it happen, call setup again with the same changes, apply: true and this check.'
		};
	}

	return db.transaction(() => {
		const r = exec();
		if (input.check && input.check !== r.check)
			throw new ActionError('conflict', 'Something changed since the preview (or the changes are not the same). Preview again and show the user the new result.');
		const id = randomUUID();
		const summary = r.changes.map((c) => c.summary);
		db.insert(undoSnapshot).values({ id, accountId: actor.accountId, data: { setup: r.run.undo, summary, today } }).run();
		emit(actor, 'setup.applied', { data: { undo: id, summary, habits: [...r.run.touched.habits], tasks: [...r.run.touched.tasks] } });
		return {
			preview: false,
			undo: id,
			summary,
			changes: r.changes,
			after: r.after,
			next: 'Saved. Tell the user what changed. setup_undo with this undo id puts it all back (for a day).'
		};
	});
}

interface SetupBatch {
	setup: UndoStep[];
	summary: string[];
	undone?: boolean;
}

/** Put back everything one applied setup request changed, newest change first. */
export function undoSetup(actor: Actor, id: string) {
	requireScope(actor, 'edit');
	const row = db.select().from(undoSnapshot).where(and(eq(undoSnapshot.id, id), eq(undoSnapshot.accountId, actor.accountId))).get();
	const b = row?.data as SetupBatch | undefined;
	if (!row || !Array.isArray(b?.setup) || Date.now() - row.createdAt.getTime() > KEEP_MS) throw new ActionError('not_found', 'No setup change with that id to undo (they are kept for a day).');
	if (b.undone) throw new ActionError('conflict', 'That setup change was already undone.');
	const today = userToday(actor.accountId, actor.tz);
	const kept: string[] = [];
	db.transaction(() => {
		for (const u of [...b.setup].reverse()) {
			switch (u.k) {
				case 'habit':
					if (!restoreSnapshot(actor.accountId, u.snapshot)) kept.push('a habit changed again since, so it stays as it is now');
					break;
				case 'task':
					if (!restoreTaskSnapshot(actor.accountId, u.snapshot)) kept.push('a Task changed again since, so it stays as it is now');
					break;
				case 'added':
					if (u.made.habits.length) unadd(actor.accountId, u.made, today);
					else for (const t of u.made.tasks) trash(actor.accountId, 'task', t, today);
					break;
				case 'archive':
					if (u.t === 'habit') (u.archived ? unarchiveHabit : archiveHabit)(actor.accountId, u.id, today);
					else setTaskArchived(actor.accountId, u.id, !u.archived);
					break;
				case 'pack': {
					const why = undoPack(actor.accountId, u.undo);
					if (why) kept.push(why);
					break;
				}
				case 'saved':
					deleteSavedTemplate(actor.accountId, u.id);
					break;
				case 'views':
					if (JSON.stringify(getViews(actor.accountId)) === JSON.stringify(u.after)) changeViews(actor.accountId, { op: 'restore', views: u.before });
					else kept.push('the views changed again since, so they stay as they are now');
					break;
			}
		}
		db.update(undoSnapshot).set({ data: { ...b, undone: true } }).where(eq(undoSnapshot.id, id)).run();
		emit(actor, 'setup.undone', { data: { undo: id, summary: b.summary, kept } });
	});
	return { undone: b.summary, kept };
}

// ---------- reading what to change ----------

/** Names for the ids in a form, so it reads without another call. */
function namesFor(accountId: string, taskIds: string[]) {
	const tasks = taskIds.length ? db.select({ id: task.id, name: task.name }).from(task).where(inArray(task.id, taskIds)).all() : [];
	const fields = taskIds.length
		? db.select({ id: metric.id, taskId: metric.taskId, name: metric.name, unit: metric.unit, type: metric.type }).from(metric).where(and(inArray(metric.taskId, taskIds), eq(metric.archived, false))).all()
		: [];
	return {
		tasks: Object.fromEntries(tasks.map((t) => [t.id, t.name])),
		fields: Object.fromEntries(fields.map((m) => [m.id, `${tasks.find((t) => t.id === m.taskId)?.name ?? ''} › ${m.name}${m.unit ? ` (${m.unit})` : ''}`]))
	};
}

/**
 * What to change, in the shape setup takes: a habit's or Task's form with names for its ids, a
 * habit as a template file (to copy or share), a template, the list of templates, or the views.
 */
export function readSetup(actor: Actor, input: { ref: string; as?: 'form' | 'template' }) {
	requireScope(actor, 'read');
	const m = input.ref.trim().match(/^(habit|task|template|templates|views)(?::(.*))?$/i);
	if (!m) throw invalid('ref is habit:<id or name>, task:<id or name>, template:<slug or id>, templates, or views.');
	const kind = m[1].toLowerCase();
	const what = (m[2] ?? '').trim();
	const accountId = actor.accountId;
	switch (kind) {
		case 'views':
			return {
				views: viewsOf(getViews(accountId)),
				options: {
					pages: PAGES,
					sorts: SORTS,
					groups: GROUPS,
					todayLayouts: LAYOUTS,
					todaySections: SECTIONS,
					todayDone: DONE_MODES,
					todayWidgets: WIDGETS,
					todayLines: LINES,
					todayHeadline: STATS,
					habitsLines: HABIT_LINES,
					features: FEATURES,
					templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb }))
				},
				next: 'Change them with setup (op view, change: one view change; setup_guide topic "views").'
			};
		case 'templates':
			return {
				builtIn: listGallery(getUnits(accountId)).map((g) => ({
					ref: `template:${g.slug}`,
					name: g.template.name,
					description: g.template.description,
					category: g.template.meta?.category ?? 'Other',
					daysPerWeek: g.template.meta?.daysPerWeek ?? null,
					minutesPerDay: g.template.meta?.minutesPerDay ?? null,
					questions: g.template.questions.map((q) => ({ key: q.key, kind: q.kind, label: q.label, default: q.default }))
				})),
				mine: listSavedTemplates(accountId).map((s) => ({ ref: `template:${s.id}`, name: s.template.name, description: s.template.description })),
				next: 'Read one with setup_read ref "template:<slug>", or add it with setup (add_template, from: "<slug>", answers).'
			};
		case 'template': {
			const t = galleryItem(what, getUnits(accountId))?.template ?? getSavedTemplate(accountId, what)?.template;
			if (!t) throw new ActionError('not_found', `No template “${what}”. setup_read with ref "templates" lists them.`);
			return { ref: `template:${what}`, template: t, next: 'add_template takes it as it is (from) or changed (template).' };
		}
		case 'habit': {
			if (!what) throw invalid('Name the habit: habit:<id or name>.');
			const id = findHabit(actor, what).id;
			if (input.as === 'template') {
				const file = shareFile(accountId, id, { noHowTo: !actor.scopes.has('notes') });
				if (!file) throw new ActionError('not_found', 'No such habit.');
				return { ref: `habit:${id}`, template: file, next: 'Change it and pass it to add_template to make a new habit like this one.' };
			}
			const full = getHabitForm(accountId, id)!;
			// A habit's note is private like the journal: only for a key with notes access (an edit keeps it).
			const { notes: _n, ...rest } = full;
			const form = actor.scopes.has('notes') ? full : (void _n, rest as HabitForm);
			const taskIds = [...new Set(form.variants.flatMap((v) => v.slots.map((s) => s.taskId)).filter((x): x is string => !!x))];
			const all = listHabits(accountId, { archived: true });
			return {
				ref: `habit:${id}`,
				id,
				form,
				names: {
					...namesFor(accountId, taskIds),
					habits: Object.fromEntries(all.filter((h) => h.id === form.parentId || h.id === form.cue.afterHabitId || h.id === form.ifThen.habitId).map((h) => [h.id, h.name])),
					areas: Object.fromEntries(listAreas(accountId).filter((a) => a.id === form.areaId).map((a) => [a.id, a.name])),
					identities: Object.fromEntries(listIdentities(accountId).filter((i) => form.identityIds.includes(i.id)).map((i) => [i.id, i.statement]))
				},
				next: 'Change it with setup (edit_habit, set: only the fields that change).'
			};
		}
		case 'task': {
			if (!what) throw invalid('Name the Task: task:<id or name>.');
			const run = new Run(actor, userToday(accountId, actor.tz));
			const id = run.task(what);
			const full = getTaskForm(accountId, id)!;
			const { notes: _n, ...rest } = full;
			const form = actor.scopes.has('notes') ? full : (void _n, rest as TaskForm);
			const inside = form.parts.flatMap((p) => (p.kind === 'task' ? [p.taskId] : []));
			return {
				ref: `task:${id}`,
				id,
				form,
				names: { ...namesFor(accountId, inside), areas: Object.fromEntries(listAreas(accountId).filter((a) => a.id === form.areaId).map((a) => [a.id, a.name])) },
				next: 'Change it with setup (edit_task, set: only the fields that change).'
			};
		}
	}
	throw invalid('Unknown ref.');
}
