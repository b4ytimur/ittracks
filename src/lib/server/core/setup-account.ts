// Setup's changes to what belongs to the account rather than to one habit or Task: the settings
// lines, measures, Stats boards and cards, Areas, identities, tags, pauses and vacations, deleting,
// pinning, starter packs, Library Collections and the templates in your Gallery. Each runs the same
// function the app's own screen does (settings-patch, stats-change, pauses, repo/*), so a change an
// assistant makes is checked exactly like one made by hand, and says how to take it back.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { habit, metric, pause, task, tag as tagTable } from '../db/schema';
import { patchSettings, settingsNow, type SettingsSet } from '../settings-patch';
import { getPacks, getSettings, saveSettings, setPinned } from '../settings';
import { getStats } from '../stats';
import { changeStats, type StatsChanged } from '../stats-change';
import { addPause, pausesOf, removePause, restorePause, type PauseRow } from '../pauses';
import { addArea, changeArea, deleteArea, listAreas, moveAreas, restoreArea, type DeletedArea } from '../repo/areas';
import { addIdentity, deleteIdentity, listIdentities, orderIdentities, renameIdentity, restoreIdentity, type DeletedIdentity } from '../repo/identities';
import { addTag, listTags, moveTag, removeTag, renameTag } from '../repo/tags';
import { deleteCollection, listCollections, restoreCollection, saveCollection, type CollectionRow } from '../repo/collections';
import { deleteSavedTemplate, listSavedTemplates, restoreSavedTemplate, savedTemplateRow } from '../repo/saved-templates';
import { dropPack, takePack, type PackUndo } from '../packs';
import { trash, untrash, KEEP_MS as TRASH_MS } from '../trash';
import { PACKS, packById } from '$lib/packs';
import { autoTitle } from '$lib/stats/catalog';
import { boardSeeds, seedById } from '$lib/stats/auto';
import { customMeasure, isCustom, newId, perLogLabel, perLogOf, PER_LOG, type CustomMeasure, type StatCard } from '$lib/stats/model';
import { formulaProblem } from '$lib/stats/formula';
import { ActionError, type Actor } from './actor';
import { cardOf } from './analysis';
import { preparedFor } from './read';
import { catalogFor } from '../stats';

// ---------- input ----------

const ref = z.string().trim().min(1).max(200);
const fields = z.record(z.string(), z.unknown());
const list = z.array(ref).max(200);
const day = z.string().max(10);

/** The changes, shapes in setup_guide (topic "account" and "stats"). */
/** How long a deleted habit or Task can still be put back: "24 hours". */
const keptFor = () => (TRASH_MS >= 3_600_000 ? `${Math.round(TRASH_MS / 3_600_000)} hours` : `${Math.round(TRASH_MS / 60_000)} minutes`);

export const ACCOUNT_CHANGES = [
	z.object({ op: z.literal('settings'), set: fields, renames: z.record(z.string(), z.string()).optional(), unitRenames: z.record(z.string(), z.string()).optional() }),
	z.object({ op: z.literal('measure'), measure: ref.optional(), set: fields.optional(), delete: z.boolean().optional() }),
	z.object({ op: z.literal('stats'), change: fields }),
	z.object({ op: z.literal('area'), area: ref.optional(), set: fields.optional(), delete: z.boolean().optional(), order: list.optional() }),
	z.object({ op: z.literal('identity'), identity: ref.optional(), statement: z.string().trim().min(1).max(120).optional(), delete: z.boolean().optional(), order: list.optional() }),
	z.object({ op: z.literal('tag'), tag: ref, grouping: z.string().max(200).nullable().optional(), name: z.string().trim().min(1).max(40).optional(), delete: z.boolean().optional() }),
	z.object({ op: z.literal('pause'), habit: ref.optional(), from: day, to: day.optional(), note: z.string().max(120).optional(), remove: z.boolean().optional() }),
	z.object({ op: z.literal('delete'), habit: ref.optional(), task: ref.optional() }),
	z.object({ op: z.literal('pin'), habit: ref, pinned: z.boolean().optional() }),
	z.object({ op: z.literal('pack'), pack: ref, remove: z.boolean().optional() }),
	z.object({ op: z.literal('collection'), collection: ref.optional(), set: fields.optional(), delete: z.boolean().optional() }),
	z.object({ op: z.literal('remove_template'), template: ref })
] as const;

type AccountChange = z.infer<(typeof ACCOUNT_CHANGES)[number]>;
export type AccountOp = AccountChange['op'];

/** What these changes need of a setup request. */
export interface SetupRun {
	readonly actor: Actor;
	readonly today: string;
	readonly accountId: string;
	readonly undo: unknown[];
	readonly touched: { habits: Set<string>; tasks: Set<string> };
	habit(r: string): string;
	task(r: string): string;
}

/** How to take one of these changes back. */
export type AccountUndo =
	| { k: 'settings'; was: SettingsSet; now: SettingsSet; renames: Record<string, string>; unitRenames: Record<string, string> }
	| { k: 'json'; key: 'stats' | 'pinned'; before: unknown; after: unknown }
	| { k: 'area'; added?: string; id?: string; before?: { name: string; color: string; icon: string }; deleted?: DeletedArea; order?: string[] }
	| { k: 'identity'; added?: string; id?: string; before?: string; deleted?: DeletedIdentity; order?: string[] }
	| { k: 'tag'; added?: string; removed?: typeof tagTable.$inferSelect; renamed?: { id: string; from: string }; moved?: { id: string; grouping: string | null } }
	| { k: 'pause'; added?: string; removed?: PauseRow }
	| { k: 'trash'; t: 'habit' | 'task'; id: string; archived: boolean }
	| { k: 'pack'; undo: PackUndo }
	| { k: 'collection'; added?: string; before?: CollectionRow; deleted?: CollectionRow; children?: string[] }
	| { k: 'unsaved'; row: NonNullable<ReturnType<typeof savedTemplateRow>> };

interface Result {
	op: AccountOp;
	summary: string;
	habitId?: string;
	taskId?: string;
	warnings?: string[];
}

// ---------- references ----------

const low = (s: unknown) => String(s ?? '').trim().toLowerCase();
const invalid = (msg: string) => new ActionError('invalid', msg);
const notFound = (msg: string) => new ActionError('not_found', msg);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One of a list by id, else by name (any case); `what` names it in the error. */
function pick<T extends { id: string }>(items: T[], r: string, name: (x: T) => string, what: string): T {
	const hit = items.find((x) => x.id === r) ?? items.find((x) => low(name(x)) === low(r));
	if (!hit) throw notFound(`No ${what} “${r}”.`);
	return hit;
}
const habitName = (id: string) => db.select({ name: habit.name }).from(habit).where(eq(habit.id, id)).get()?.name ?? id;
const taskName = (id: string) => db.select({ name: task.name }).from(task).where(eq(task.id, id)).get()?.name ?? id;
const groupingOf = (accountId: string, r: string) => pick(settingsNow(accountId).groupings!, r, (g) => g.name, 'grouping');

/** A measure by id or name. */
const measureOf = (measures: CustomMeasure[], r: string) => pick(measures, r, (m) => m.name, 'measure');

/** Run a change to Stats and keep how to put Stats back. */
function statsStep(run: SetupRun, change: unknown): StatsChanged {
	const before = getSettings(run.accountId).stats ?? null;
	const r = changeStats(run.accountId, change, run.actor.tz);
	const after = getSettings(run.accountId).stats ?? null;
	if (JSON.stringify(before) !== JSON.stringify(after)) run.undo.push({ k: 'json', key: 'stats', before, after } satisfies AccountUndo);
	return r;
}

// ---------- Stats cards with names ----------

/** A card in the shape Stats stores, from the card the change gives: the series fields (source, measure, fields, task…) or Stats' own shape, with names where it wants ids. */
function cardFrom(run: SetupRun, raw: Record<string, unknown>, measures: CustomMeasure[]): StatCard {
	const P = preparedFor(run.actor);
	const measureId = (m: unknown) => {
		if (typeof m !== 'string' || !m) return m;
		if (m in PER_LOG || isCustom(m)) return m;
		const hit = measures.find((x) => x.id === m || low(x.name) === low(m));
		return hit ? perLogOf(hit) : m;
	};
	const habits = (xs: unknown) => (Array.isArray(xs) ? xs.map((h) => run.habit(String(h))) : undefined);
	const areas = (xs: unknown) => (Array.isArray(xs) ? xs.map((a) => pick(listAreas(run.accountId), String(a), (x) => x.name, 'Area').id) : undefined);
	let card: Record<string, unknown>;
	if (isObj(raw.what)) {
		const what = { ...raw.what };
		if (typeof what.taskId === 'string' && what.taskId) what.taskId = run.task(what.taskId);
		card = { ...raw, what, perLog: measureId(raw.perLog) };
	} else {
		const { title, chart, size, range, goal, goalMax, previous, rolling, running, stacked, top, grouping, id, areas: _a, ...spec } = raw;
		void _a;
		card = {
			...cardOf(run.actor, P, { ...spec, measure: measureId(spec.measure) as string | undefined } as never),
			...(id ? { id } : {}),
			...(title !== undefined ? { title } : {}),
			...(range !== undefined ? { range } : {}),
			...(grouping !== undefined ? { grouping } : {}),
			look: { chart: chart ?? 'line', size: size ?? 'small', stacked: stacked ?? false, top: top ?? 8 },
			compare: { previous: previous ?? false, goal: goal ?? null, goalMax: goalMax ?? null, running: running ?? false, rolling: rolling ?? 0 }
		};
	}
	const filter = isObj(card.filter) ? { ...card.filter } : {};
	if (Array.isArray(filter.habits)) filter.habits = habits(filter.habits);
	if (Array.isArray(filter.areas)) filter.areas = areas(filter.areas);
	if (Array.isArray(raw.areas)) filter.areas = areas(raw.areas);
	card.filter = filter;
	if (!card.id) card.id = newId();
	return card as StatCard;
}

/** A Stats change with names where it wants ids: boards and cards by name, habits by name. */
function resolveStats(run: SetupRun, raw: Record<string, unknown>): Record<string, unknown> {
	const c = { ...raw };
	const s = getStats(run.accountId);
	const board = (r: unknown) => pick(s.boards, String(r), (b) => b.name, 'board').id;
	const cards = (w: Record<string, unknown>) => ('board' in w ? (s.boards.find((b) => b.id === w.board)?.cards ?? []) : (s.habitCards[String(w.habit)] ?? []));
	const cardId = (w: Record<string, unknown>, r: unknown) => {
		const all = cards(w);
		return all.find((x) => x.id === r)?.id ?? all.find((x) => low(x.title) === low(r))?.id ?? String(r);
	};
	if (typeof c.op === 'string' && ['board.patch', 'board.delete', 'board.move'].includes(c.op)) c.id = board(c.id ?? c.board);
	if (c.op === 'board.add' && typeof c.template === 'string' && !seedById(c.template)) throw notFound(`No board template “${c.template}”. setup_read ref "stats" lists them.`);
	if (c.op === 'open' && c.value !== 'last') c.value = board(c.value);
	if (isObj(c.where)) {
		const w = { ...c.where };
		if ('board' in w) w.board = board(w.board);
		if ('habit' in w) w.habit = run.habit(String(w.habit));
		c.where = w;
		if (c.op === 'card.delete') c.id = cardId(w, c.id ?? c.card);
		if (c.op === 'card.order' && Array.isArray(c.ids)) c.ids = c.ids.map((x) => cardId(w, x));
		if (c.op === 'card.save' && isObj(c.card)) {
			const id = c.card.id ? cardId(w, c.card.id) : undefined;
			c.card = cardFrom(run, { ...c.card, ...(id ? { id } : {}) }, s.measures);
		}
	}
	if ((c.op === 'habit.reset' || c.op === 'headline') && typeof c.habit === 'string') c.habit = run.habit(c.habit);
	if (c.op === 'headline' && isObj(c.card)) c.card = cardFrom(run, c.card, s.measures);
	if (c.op === 'measure.delete' && typeof c.id === 'string') c.id = measureOf(s.measures, c.id).id;
	if (c.op === 'measure.save' && isObj(c.measure) && !c.measure.id) c.measure = { ...c.measure, id: newId() };
	return c;
}

const STATS_SAID: Record<string, (c: Record<string, unknown>, s: ReturnType<typeof getStats>) => string> = {
	'board.add': (c) => `Add the Stats board “${c.name ?? (typeof c.template === 'string' ? (seedById(c.template)?.name ?? c.template) : 'New board')}”`,
	'board.patch': (c, s) => `Change the Stats board “${s.boards.find((b) => b.id === c.id)?.name}”: ${Object.keys(c).filter((k) => !['op', 'id'].includes(k)).join(', ')}`,
	'board.delete': (c, s) => `Delete the Stats board “${s.boards.find((b) => b.id === c.id)?.name}”`,
	'board.move': (c, s) => `Move the Stats board “${s.boards.find((b) => b.id === c.id)?.name}” ${c.dir === -1 ? 'up' : 'down'}`,
	'board.restore': () => 'Put a Stats board back',
	'card.save': (c) => `Save the card “${(c.card as StatCard).title || 'untitled'}” on ${'board' in (c.where as object) ? 'a Stats board' : `the Stats tab of “${habitName(String((c.where as { habit: string }).habit))}”`}`,
	'card.delete': () => 'Delete a Stats card',
	'card.order': () => 'Put Stats cards in a new order',
	'habit.reset': (c) => `Put the Stats tab of “${habitName(String(c.habit))}” back to its automatic cards`,
	open: (c, s) => `Stats opens with ${c.value === 'last' ? 'the board it was on last' : `“${s.boards.find((b) => b.id === c.value)?.name}”`}`,
	last: () => 'Remember the board Stats was on',
	headline: (c) => (c.card ? `Show a number for “${habitName(String(c.habit))}” on Today` : `Take the number for “${habitName(String(c.habit))}” off Today`),
	'measure.save': (c) => `Save the measure “${(c.measure as CustomMeasure).name}”`,
	'measure.delete': () => 'Delete a measure'
};

// ---------- the changes ----------

type Op<K extends AccountOp> = (run: SetupRun, c: Extract<AccountChange, { op: K }>) => Result;

const SETTING_SAID: Record<string, string> = {
	dayStart: 'day start',
	ranges: 'parts of the day',
	pastDays: 'logging past days',
	nudgeYesterday: 'asking about yesterday',
	dayNote: 'day note',
	guidedSetup: 'new habits',
	units: 'units',
	groupings: 'groupings',
	taskTypes: 'Task types'
};

export const ACCOUNT_OPS: { [K in AccountOp]: Op<K> } = {
	settings: (run, c) => {
		const cur = settingsNow(run.accountId) as unknown as Record<string, unknown>;
		const keys = Object.keys(c.set);
		const r = patchSettings(run.accountId, { set: c.set, was: Object.fromEntries(keys.map((k) => [k, cur[k] ?? null])), renames: c.renames ?? {}, unitRenames: c.unitRenames ?? {} });
		if ('error' in r) throw invalid(r.error);
		if ('moved' in r) throw new ActionError('conflict', `These changed while this ran: ${r.moved.join(', ')}. Try again.`);
		const changed = Object.keys(r.now);
		if (changed.length) run.undo.push({ k: 'settings', was: r.was, now: r.now, renames: r.renames, unitRenames: r.unitRenames } satisfies AccountUndo);
		return { op: c.op, summary: changed.length ? `Change settings: ${changed.map((k) => SETTING_SAID[k] ?? k).join(', ')}` : 'Settings: nothing changes' };
	},

	measure: (run, c) => {
		const s = getStats(run.accountId);
		const hit = c.measure ? measureOf(s.measures, c.measure) : undefined;
		if (c.delete) {
			if (!hit) throw invalid('Name the measure to delete.');
			const r = statsStep(run, { op: 'measure.delete', id: hit.id });
			return { op: c.op, summary: r.used ? `Turn off the measure “${hit.name}” (${plural(r.used, 'card')} still count by it, so it stays for them)` : `Delete the measure “${hit.name}”`, warnings: r.warnings };
		}
		if (!c.set) throw invalid('measure takes set: the measure (name, formula, …), or delete: true.');
		const name = typeof c.set.name === 'string' ? c.set.name : hit?.name;
		if (!hit && s.measures.some((m) => low(m.name) === low(name))) throw new ActionError('conflict', `There is already a measure called “${name}”. Name it in measure to change it.`);
		const parsed = customMeasure.safeParse({ ...(hit ?? { id: newId() }), ...c.set });
		if (!parsed.success) throw invalid(`The measure: ${parsed.error.issues[0].path.join('.')} ${parsed.error.issues[0].message}`);
		const m = parsed.data;
		const r = statsStep(run, { op: 'measure.save', measure: m });
		const missing = formulaProblem(m.formula, knownFields(run.accountId));
		return {
			op: c.op,
			summary: hit ? `Change the measure “${hit.name}”: ${Object.keys(c.set).join(', ')}` : `Add the measure “${m.name}”: ${m.formula}${m.unit ? ` in ${m.unit}` : ''}`,
			warnings: [...r.warnings, ...(missing ? [`${missing}. It counts nothing until a Task has those fields.`] : [])]
		};
	},

	stats: (run, c) => {
		const before = getStats(run.accountId);
		const change = resolveStats(run, c.change);
		const r = statsStep(run, change);
		const said = STATS_SAID[String(change.op)]?.(change, before) ?? 'Change Stats';
		return { op: c.op, summary: said, ...(typeof change.habit === 'string' ? { habitId: change.habit } : {}), warnings: r.warnings };
	},

	area: (run, c) => {
		const all = listAreas(run.accountId);
		if (c.order) {
			const order = c.order.map((a) => pick(all, a, (x) => x.name, 'Area').id);
			run.undo.push({ k: 'area', order: all.map((a) => a.id) } satisfies AccountUndo);
			moveAreas(run.accountId, order);
			return { op: c.op, summary: `Put the Areas in this order: ${order.map((id) => all.find((a) => a.id === id)!.name).join(', ')}` };
		}
		if (!c.area) throw invalid('area takes area (its name or id), or order.');
		const hit = all.find((a) => a.id === c.area) ?? all.find((a) => low(a.name) === low(c.area));
		const set = (c.set ?? {}) as { name?: string; color?: string; icon?: string };
		if (c.delete) {
			if (!hit) throw notFound(`No Area “${c.area}”.`);
			const deleted = deleteArea(run.accountId, hit.id)!;
			run.undo.push({ k: 'area', deleted } satisfies AccountUndo);
			return { op: c.op, summary: `Delete the Area “${hit.name}” (${plural(deleted.habitIds.length, 'habit')} and ${plural(deleted.taskIds.length, 'Task')} lose it)` };
		}
		if (!hit) {
			const made = addArea(run.accountId, set.name ?? c.area)!;
			if (set.color || set.icon) if (!changeArea(run.accountId, made.id, { ...(set.color ? { color: set.color } : {}), ...(set.icon !== undefined ? { icon: set.icon } : {}) })) throw invalid('An Area colour is like #3b82f6.');
			run.undo.push({ k: 'area', added: made.id } satisfies AccountUndo);
			return { op: c.op, summary: `Add the Area “${set.name ?? c.area}”` };
		}
		const values = Object.fromEntries(Object.entries(set).filter(([k, v]) => ['name', 'color', 'icon'].includes(k) && typeof v === 'string'));
		if (!Object.keys(values).length) return { op: c.op, summary: `Area “${hit.name}”: nothing changes` };
		if (!changeArea(run.accountId, hit.id, values)) throw invalid('An Area needs a name, and a colour like #3b82f6.');
		run.undo.push({ k: 'area', id: hit.id, before: { name: hit.name, color: hit.color, icon: hit.icon } } satisfies AccountUndo);
		return { op: c.op, summary: `Change the Area “${hit.name}”: ${Object.keys(values).join(', ')}` };
	},

	identity: (run, c) => {
		const all = listIdentities(run.accountId);
		const name = (i: { statement: string }) => i.statement;
		if (c.order) {
			const order = c.order.map((r) => pick(all, r, name, 'identity').id);
			run.undo.push({ k: 'identity', order: all.map((i) => i.id) } satisfies AccountUndo);
			orderIdentities(run.accountId, order);
			return { op: c.op, summary: 'Put the identities in a new order' };
		}
		if (!c.identity) throw invalid('identity takes identity (its sentence or id), or order.');
		const hit = all.find((i) => i.id === c.identity) ?? all.find((i) => low(i.statement) === low(c.identity));
		if (c.delete) {
			if (!hit) throw notFound(`No identity “${c.identity}”.`);
			const deleted = deleteIdentity(run.accountId, hit.id)!;
			run.undo.push({ k: 'identity', deleted } satisfies AccountUndo);
			return { op: c.op, summary: `Delete the identity “${hit.statement}” (${plural(deleted.habitIds.length, 'habit')} had it)` };
		}
		if (!hit) {
			const id = addIdentity(run.accountId, c.statement ?? c.identity);
			run.undo.push({ k: 'identity', added: id } satisfies AccountUndo);
			return { op: c.op, summary: `Add the identity “${c.statement ?? c.identity}”` };
		}
		if (!c.statement || c.statement === hit.statement) return { op: c.op, summary: `Identity “${hit.statement}”: nothing changes` };
		renameIdentity(run.accountId, hit.id, c.statement);
		run.undo.push({ k: 'identity', id: hit.id, before: hit.statement } satisfies AccountUndo);
		return { op: c.op, summary: `Reword the identity “${hit.statement}” as “${c.statement}”` };
	},

	tag: (run, c) => {
		const hit = listTags(run.accountId).find((t) => t.id === c.tag) ?? listTags(run.accountId).find((t) => low(t.name) === low(c.tag));
		const grouping = c.grouping === undefined ? undefined : c.grouping === null ? null : groupingOf(run.accountId, c.grouping);
		if (c.delete) {
			if (!hit) throw notFound(`No tag “${c.tag}”.`);
			const r = removeTag(run.accountId, hit.id);
			if ('error' in r) throw invalid(r.error);
			run.undo.push({ k: 'tag', removed: r.removed } satisfies AccountUndo);
			return { op: c.op, summary: `Remove the tag “${hit.name}”` };
		}
		if (!hit) {
			if (!grouping) throw invalid(`“${c.tag}” is a new tag: say which grouping it goes in.`);
			const r = addTag(run.accountId, c.name ?? c.tag, grouping.id);
			if ('error' in r) throw invalid(r.error);
			run.undo.push({ k: 'tag', added: r.id } satisfies AccountUndo);
			return { op: c.op, summary: `Add the tag “${c.name ?? c.tag}” to ${grouping.name}` };
		}
		const said: string[] = [];
		if (grouping !== undefined && (grouping?.id ?? null) !== hit.grouping) {
			const r = moveTag(run.accountId, hit.id, grouping?.id ?? null);
			if ('error' in r) throw invalid(r.error);
			run.undo.push({ k: 'tag', moved: { id: hit.id, grouping: r.was } } satisfies AccountUndo);
			said.push(grouping ? `move it to ${grouping.name}` : 'take it out of its grouping');
		}
		if (c.name && c.name !== hit.name) {
			const r = renameTag(run.accountId, hit.id, c.name);
			if ('error' in r) throw invalid(r.error);
			run.undo.push({ k: 'tag', renamed: { id: hit.id, from: r.was } } satisfies AccountUndo);
			said.push(`rename it “${c.name}”`);
		}
		return { op: c.op, summary: said.length ? `Tag “${hit.name}”: ${said.join(', ')}` : `Tag “${hit.name}”: nothing changes` };
	},

	pause: (run, c) => {
		const habitId = c.habit ? run.habit(c.habit) : null;
		const whose = habitId ? `“${habitName(habitId)}”` : 'every habit (vacation)';
		if (habitId) run.touched.habits.add(habitId);
		if (c.remove) {
			const p = pausesOf(run.accountId, habitId).find((x) => x.start <= c.from && c.from <= x.end);
			if (!p) throw notFound(`No pause of ${whose} on ${c.from}.`);
			removePause(run.accountId, p.id, run.today);
			run.undo.push({ k: 'pause', removed: p } satisfies AccountUndo);
			return { op: c.op, summary: `End the pause of ${whose} from ${p.start} to ${p.end}: those days count again`, habitId: habitId ?? undefined };
		}
		const r = addPause(run.accountId, habitId, c.from, c.to ?? c.from, c.note ?? null, run.today);
		if ('error' in r) throw invalid(r.error);
		run.undo.push({ k: 'pause', added: r.id } satisfies AccountUndo);
		return { op: c.op, summary: `Pause ${whose} from ${c.from} to ${c.to ?? c.from}${c.note ? ` (${c.note})` : ''}`, habitId: habitId ?? undefined };
	},

	delete: (run, c) => {
		if (!c.habit === !c.task) throw invalid('delete takes a habit or a task.');
		const t = c.habit ? 'habit' : 'task';
		const id = c.habit ? run.habit(c.habit) : run.task(c.task!);
		const name = t === 'habit' ? habitName(id) : taskName(id);
		const r = trash(run.accountId, t, id, run.today);
		if (!r) throw notFound(`No ${t} “${c.habit ?? c.task}”.`);
		run.undo.push({ k: 'trash', t, id, archived: r.archived } satisfies AccountUndo);
		return {
			op: c.op,
			summary: `Delete the ${t === 'habit' ? 'habit' : 'Task'} “${name}” with everything logged in it`,
			warnings: [`It is gone for good after ${keptFor()}, and setup_undo can bring it back only until then. Archive keeps it and every log.`]
		};
	},

	pin: (run, c) => {
		const id = run.habit(c.habit);
		const pinned = c.pinned ?? true;
		const before = getSettings(run.accountId).pinned;
		setPinned(run.accountId, id, pinned);
		const after = getSettings(run.accountId).pinned;
		if (JSON.stringify(before) !== JSON.stringify(after)) run.undo.push({ k: 'json', key: 'pinned', before, after } satisfies AccountUndo);
		const dropped = before.filter((x) => !after.includes(x) && x !== id);
		return {
			op: c.op,
			summary: pinned ? `Offer “${habitName(id)}” as a home screen shortcut` : `Stop offering “${habitName(id)}” as a home screen shortcut`,
			habitId: id,
			warnings: dropped.length ? [`The menu holds four, so “${habitName(dropped[0])}” leaves it.`] : []
		};
	},

	pack: (run, c) => {
		const p = packById(c.pack) ?? PACKS.find((x) => low(x.name) === low(c.pack));
		if (!p) throw notFound(`No starter pack “${c.pack}”. setup_read ref "settings" lists them.`);
		const have = getPacks(run.accountId).includes(p.id);
		if (c.remove ? !have : have) return { op: c.op, summary: `The starter pack “${p.name}” is ${have ? 'already in' : 'not in'}` };
		const r = c.remove ? dropPack(run.accountId, p.id) : takePack(run.accountId, p.id);
		if ('error' in r) throw invalid(r.error);
		run.undo.push({ k: 'pack', undo: r.undo } satisfies AccountUndo);
		return { op: c.op, summary: c.remove ? `Take the starter pack “${p.name}” out (only what nothing uses goes)` : `Copy in the starter pack “${p.name}”: ${p.brings}`, warnings: r.kept };
	},

	collection: (run, c) => {
		const all = listCollections(run.accountId);
		const hit = c.collection ? (all.find((x) => x.id === c.collection) ?? all.find((x) => low(x.name) === low(c.collection))) : undefined;
		if (c.delete) {
			if (!hit) throw notFound(`No Collection “${c.collection}”.`);
			const children = all.filter((x) => x.parentId === hit.id).map((x) => x.id);
			deleteCollection(run.accountId, hit.id);
			run.undo.push({ k: 'collection', deleted: hit, children } satisfies AccountUndo);
			return { op: c.op, summary: `Delete the Collection “${hit.name}” (its Tasks stay in the Library)` };
		}
		const set = c.set ?? {};
		const parent = set.parent === undefined ? (hit?.parentId ?? null) : set.parent === null ? null : pick(all, String(set.parent), (x) => x.name, 'Collection').id;
		const filter = set.filter === undefined ? (hit?.filter ?? null) : set.filter === null ? null : filterOf(run, set.filter);
		const taskIds = Array.isArray(set.tasks) ? set.tasks.map((t) => run.task(String(t))) : (hit?.taskIds ?? []);
		const name = typeof set.name === 'string' && set.name.trim() ? set.name.trim().slice(0, 60) : (hit?.name ?? c.collection);
		if (!name) throw invalid('A new Collection needs a name.');
		const id = saveCollection(run.accountId, hit?.id ?? null, { name, parentId: parent, filter, taskIds });
		if (!id) throw notFound(`No Collection “${c.collection}”.`);
		run.undo.push((hit ? { k: 'collection', before: hit } : { k: 'collection', added: id }) satisfies AccountUndo);
		return { op: c.op, summary: hit ? `Change the Collection “${hit.name}”` : `Add the Collection “${name}”${filter ? ' (a saved filter)' : ` with ${plural(taskIds.length, 'Task')}`}` };
	},

	remove_template: (run, c) => {
		const mine = listSavedTemplates(run.accountId);
		const hit = mine.find((t) => t.id === c.template) ?? mine.find((t) => low(t.template.name) === low(c.template));
		if (!hit) throw notFound(`No template “${c.template}” in My templates.`);
		const row = savedTemplateRow(run.accountId, hit.id)!;
		deleteSavedTemplate(run.accountId, hit.id);
		run.undo.push({ k: 'unsaved', row } satisfies AccountUndo);
		return { op: c.op, summary: `Take “${hit.template.name}” out of My templates (habits added from it stay)` };
	}
};

/** A smart Collection's filter, with an Area by name. */
function filterOf(run: SetupRun, raw: unknown) {
	const f = isObj(raw) ? raw : {};
	const areaId = typeof f.area === 'string' || typeof f.areaId === 'string' ? pick(listAreas(run.accountId), String(f.area ?? f.areaId), (a) => a.name, 'Area').id : null;
	return { tags: Array.isArray(f.tags) ? f.tags.map(String).slice(0, 50) : [], areaId, text: typeof f.text === 'string' ? f.text.slice(0, 120) : '' };
}

/** Every field name the account's Tasks have, for a formula's warning. */
const knownFields = (accountId: string): string[] => [
	...new Set(
		db
			.select({ name: metric.name })
			.from(metric)
			.innerJoin(task, eq(metric.taskId, task.id))
			.where(eq(task.accountId, accountId))
			.all()
			.map((m) => m.name)
	)
];

// ---------- undo ----------

const invert = (r: Record<string, string>) => Object.fromEntries(Object.entries(r).map(([a, b]) => [b, a]));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Take one change back. Says why when something changed since, and it is left as it is. */
export function undoAccount(actor: Actor, u: AccountUndo, today: string): string | null {
	const accountId = actor.accountId;
	switch (u.k) {
		case 'settings': {
			const r = patchSettings(accountId, { set: u.was, was: u.now, renames: invert(u.renames), unitRenames: invert(u.unitRenames) });
			if ('moved' in r) return `the settings (${r.moved.map((k) => SETTING_SAID[k] ?? k).join(', ')}) changed again since, so they stay as they are now`;
			if ('error' in r) return `the settings could not be put back: ${r.error}`;
			return null;
		}
		case 'json': {
			const now = u.key === 'stats' ? (getSettings(accountId).stats ?? null) : getSettings(accountId).pinned;
			if (!same(now, u.after)) return u.key === 'stats' ? 'Stats changed again since, so it stays as it is now' : 'the shortcuts changed again since, so they stay as they are now';
			saveSettings(accountId, { [u.key]: u.before ?? undefined });
			return null;
		}
		case 'area':
			if (u.order) moveAreas(accountId, u.order);
			else if (u.added) deleteArea(accountId, u.added);
			else if (u.deleted) restoreArea(accountId, u.deleted);
			else if (u.id && u.before) changeArea(accountId, u.id, u.before);
			return null;
		case 'identity':
			if (u.order) orderIdentities(accountId, u.order);
			else if (u.added) deleteIdentity(accountId, u.added);
			else if (u.deleted) restoreIdentity(accountId, u.deleted);
			else if (u.id && u.before) renameIdentity(accountId, u.id, u.before);
			return null;
		case 'tag': {
			if (u.added) {
				const r = removeTag(accountId, u.added);
				return 'error' in r && r.status === 400 ? 'a tag added then is on a Task now, so it stays' : null;
			}
			if (u.removed && !listTags(accountId).some((t) => low(t.name) === low(u.removed!.name))) db.insert(tagTable).values({ ...u.removed, accountId }).run();
			if (u.renamed) {
				const r = renameTag(accountId, u.renamed.id, u.renamed.from);
				if ('error' in r) return `a tag could not get its old name back: ${r.error}`;
			}
			if (u.moved) moveTag(accountId, u.moved.id, u.moved.grouping);
			return null;
		}
		case 'pause':
			if (u.added) removePause(accountId, u.added, today);
			if (u.removed) restorePause(accountId, u.removed, today);
			return null;
		case 'trash':
			return untrash(accountId, u.t, u.id, u.archived, today) ? null : `the deleted ${u.t === 'habit' ? 'habit' : 'Task'} is gone for good (after ${keptFor()})`;
		case 'pack':
			return null; // setup.ts runs the pack's own undo
		case 'collection':
			if (u.added) deleteCollection(accountId, u.added);
			else if (u.deleted) restoreCollection(accountId, u.deleted, u.children ?? []);
			else if (u.before) saveCollection(accountId, u.before.id, u.before);
			return null;
		case 'unsaved':
			restoreSavedTemplate(accountId, u.row);
			return null;
	}
}

// ---------- reading ----------

/** A card's name as Stats shows it. */
const cardTitle = (c: StatCard, measures: CustomMeasure[]) => c.title || `${perLogLabel(c.perLog, measures)} of ${c.what.source}`;

/**
 * The account's own things as a person reads them, flat, so a preview shows only the parts a
 * change touched (before and after).
 */
export function accountOf(accountId: string) {
	const s = settingsNow(accountId);
	const st = getStats(accountId);
	const groupings = s.groupings!;
	const all = listCollections(accountId);
	return {
		dayStart: s.dayStart ?? null,
		ranges: s.ranges,
		pastDays: s.pastDays,
		nudgeYesterday: s.nudgeYesterday,
		dayNote: s.dayNote,
		guidedSetup: s.guidedSetup,
		units: s.units,
		groupings,
		taskTypes: s.taskTypes,
		measures: st.measures,
		boards: st.boards.map((b) => ({ name: b.name, range: b.range, cards: b.cards.map((c) => cardTitle(c, st.measures)) })),
		habitStatsTabs: Object.fromEntries(Object.entries(st.habitCards).map(([h, cards]) => [habitName(h), cards.map((c) => cardTitle(c, st.measures))])),
		todayNumbers: Object.fromEntries(Object.entries(st.headlines).map(([h, c]) => [habitName(h), cardTitle(c, st.measures)])),
		areas: listAreas(accountId).map((a) => ({ name: a.name, color: a.color, icon: a.icon })),
		identities: listIdentities(accountId).map((i) => i.statement),
		tags: listTags(accountId)
			.map((t) => ({ name: t.name, grouping: groupings.find((g) => g.id === t.grouping)?.name ?? null }))
			.sort((a, b) => a.name.localeCompare(b.name)),
		vacations: pausesOf(accountId, null).map((p) => ({ from: p.start, to: p.end, note: p.note })),
		pauses: pausesAll(accountId),
		shortcuts: s.pinned.map(habitName),
		packs: getPacks(accountId).map((id) => packById(id)?.name ?? id),
		collections: all.map((c) => ({ name: c.name, inside: all.find((x) => x.id === c.parentId)?.name ?? null, ...(c.filter ? { filter: c.filter } : { tasks: c.taskIds.map(taskName) }) })),
		myTemplates: listSavedTemplates(accountId).map((t) => t.template.name)
	};
}

function pausesAll(accountId: string) {
	return db
		.select({ habit: habit.name, from: pause.start, to: pause.end, note: pause.note })
		.from(pause)
		.innerJoin(habit, eq(pause.habitId, habit.id))
		.where(eq(pause.accountId, accountId))
		.all()
		.sort((a, b) => (a.from < b.from ? -1 : 1));
}

/** The parts of `accountOf` that differ, before and after. */
export function accountDiff(before: ReturnType<typeof accountOf>, after: ReturnType<typeof accountOf>) {
	const keys = (Object.keys(after) as (keyof typeof after)[]).filter((k) => !same(before[k], after[k]));
	if (!keys.length) return null;
	return { before: Object.fromEntries(keys.map((k) => [k, before[k]])), after: Object.fromEntries(keys.map((k) => [k, after[k]])) };
}

/** Settings as setup's settings change takes them, with what the other changes act on and their ids. */
export function readAccount(accountId: string) {
	const s = settingsNow(accountId);
	const groupings = s.groupings!;
	return {
		settings: { dayStart: s.dayStart ?? null, ranges: s.ranges, pastDays: s.pastDays, nudgeYesterday: s.nudgeYesterday, dayNote: s.dayNote, guidedSetup: s.guidedSetup, units: s.units, groupings, taskTypes: s.taskTypes },
		areas: listAreas(accountId).map((a) => ({ id: a.id, name: a.name, color: a.color, icon: a.icon })),
		identities: listIdentities(accountId),
		tags: listTags(accountId).map((t) => ({ id: t.id, name: t.name, grouping: groupings.find((g) => g.id === t.grouping)?.name ?? null })),
		vacations: pausesOf(accountId, null).map((p) => ({ from: p.start, to: p.end, note: p.note })),
		pauses: pausesAll(accountId),
		shortcuts: s.pinned.map((id) => ({ id, name: habitName(id) })),
		packs: PACKS.map((p) => ({ id: p.id, name: p.name, brings: p.brings, in: getPacks(accountId).includes(p.id) })),
		collections: listCollections(accountId).map((c) => ({ id: c.id, name: c.name, parent: c.parentId, filter: c.filter, tasks: c.taskIds.map(taskName) })),
		myTemplates: listSavedTemplates(accountId).map((t) => ({ id: t.id, name: t.template.name })),
		next: 'Change settings with setup (op settings, set: only the keys that change; a list is replaced whole). Areas, identities, tags, pauses, packs, Collections: setup_guide topic "account".'
	};
}

/** Stats as setup's stats and measure changes take it. */
export function readStats(actor: Actor) {
	const st = getStats(actor.accountId);
	const P = preparedFor(actor);
	const catalog = catalogFor(actor.accountId, P);
	const named = (c: StatCard) => ({ ...c, title: c.title || autoTitle(c, catalog, st.measures) });
	return {
		measures: st.measures,
		boards: st.boards.map((b) => ({ ...b, cards: b.cards.map(named) })),
		habitStatsTabs: Object.fromEntries(Object.entries(st.habitCards).map(([h, cards]) => [habitName(h), { habitId: h, cards: cards.map(named) }])),
		todayNumbers: Object.fromEntries(Object.entries(st.headlines).map(([h, c]) => [habitName(h), named(c)])),
		boardTemplates: boardSeeds(getPacks(actor.accountId)).map((b) => ({ id: b.id, name: b.name, blurb: b.blurb })),
		next: 'Change it with setup (op stats, change: one Stats change; op measure for measures). setup_guide topic "stats" has the shapes; analysis_options lists sources, measures, splits and buckets.'
	};
}

