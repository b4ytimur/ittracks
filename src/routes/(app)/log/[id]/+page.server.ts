import { randomUUID } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { entry, metric, occurrence, slot, task, variant } from '$lib/server/db/schema';
import { groupOfOccurrence, ownedOccurrence } from '$lib/server/owned';
import { currentForm } from '$lib/server/habit-patch';
import { ensurePicks, lastEntries, recount, userToday } from '$lib/server/today';
import { finishAs } from '$lib/server/progress';
import { PATH_RE, place, startsRound } from '$lib/engine/parts';
import { aimFor, aimText, goneFrom } from '$lib/log/places';
import { partIdsIn, plannedSlots, positionsOf } from '$lib/server/positions';
import { getSettings, getUnits } from '$lib/server/settings';
import { recapFor } from '$lib/server/stats';
import { planOfToday, replanToday, windowFor } from '$lib/server/backfill';
import { NOTE_MAX, type ScheduleForm } from '$lib/forms';
import { ActionError, appActor } from '$lib/server/core/actor';
import { hasParts, ownTask, rerollSlot, swapLibrary, swapSlot, usedBefore, type Used } from '$lib/server/day-plan';
import { emit } from '$lib/server/core/events';
import { doneOcc, leftOpen, reopenOcc, skipOcc, undoClears } from '$lib/server/core/log';
import { routineDay, routineSteps, undoRoutine, withRoutineUndo } from '$lib/server/routine-day';
import { contentOf, staleSave } from '$lib/server/stale';
import { revOf } from '$lib/logrev';
import type { Actions, PageServerLoad } from './$types';

/** One place in the log (see engine/parts.ts): a Slot's Task, or a Task inside it. */
export interface LogTask {
	path: string;
	slotId: string;
	/** 0 for a Slot's own Task; parts sit deeper. */
	depth: number;
	/** Parts inside it, which follow it in the list. */
	kids: number;
	/** "Circuit · round 2 of 3", above the first place of each round. */
	roundHead: string | null;
	/** An auto-filled Slot: can be rerolled. Only a Slot's own Task can be rerolled or swapped. */
	open: boolean;
	/** The Task its Slot has in the plan, without this log's swap: null for an auto-filled one. */
	own: string | null;
	/** An open log's fixed Slot: the other Tasks used in it before, newest first, for its ⋯ and the swap picker. */
	used: Used[];
	sets: number | null;
	targets: Record<string, number>;
	minTargets: Record<string, number>;
	stretchTargets: Record<string, number>;
	task: {
		id: string;
		name: string;
		restTimerEnabled: boolean;
		restTimerSeconds: number;
		/** Its own words: one row, several, the clock between two. */
		rowOne: string;
		rowMany: string;
		betweenName: string;
		metrics: {
			id: string;
			name: string;
			type: string;
			unit: string | null;
			repeats: boolean;
			times: boolean;
			/** A Choice's options: the value is the option's id. */
			choices: { id: string; name: string }[] | null;
			prefill: 'last' | 'target' | 'blank';
			step: number | null;
			required: boolean;
			quick: boolean;
			long: boolean;
			starter: string;
			prompts: string[];
			promptOrder: 'order' | 'random';
		}[];
		/** Markdown: shown as a collapsible "How to" on the log screen. */
		notes: string;
	} | null;
	saved: Record<string, unknown>[];
	previous: Record<string, unknown>[];
}

/**
 * A Task as the log screen shows it. Archived fields are left out, except those this log
 * already has a value for (`kept`), so a past log shows and saves them as they are.
 */
function loadTask(id: string, kept: Set<string>) {
	const t = db.select().from(task).where(eq(task.id, id)).get();
	if (!t) return null;
	return {
		id: t.id,
		name: t.name,
		restTimerEnabled: t.restTimerEnabled,
		restTimerSeconds: t.restTimerSeconds,
		rowOne: t.rowOne,
		rowMany: t.rowMany,
		betweenName: t.betweenName,
		notes: t.notes ?? '',
		metrics: db
			.select()
			.from(metric)
			.where(eq(metric.taskId, id))
			.orderBy(asc(metric.sortOrder))
			.all()
			.filter((m) => !m.archived || kept.has(m.id))
			.map(({ id, name, type, unit, repeats, times, choices, prefill, step, required, quick, long, starter, prompts, promptOrder }) => ({
				id,
				name,
				type,
				unit,
				repeats,
				times,
				// Options a new log offers, and archived ones this log picked, so it reads and saves as is.
				choices: choices ? choices.filter((o) => !o.archived || kept.has(o.id)).map((o) => ({ id: o.id, name: o.name })) : null,
				prefill,
				step,
				required,
				quick,
				long: type === 'text' && long,
				starter: starter ?? '',
				prompts: prompts ?? [],
				promptOrder
			}))
	};
}

/** The Library, for the done lines' names, the plan editor and, in an open log, the swap picker: its Tags and last time too. */
function libraryFor(accountId: string, occ: { id: string; date: string }, swaps: boolean) {
	const rows = db
		.select({ id: task.id, name: task.name, archived: task.archived, rowOne: task.rowOne, rowMany: task.rowMany })
		.from(task)
		.where(and(eq(task.accountId, accountId), isNull(task.parentTaskId), isNull(task.deleteAfter)))
		.orderBy(asc(task.name))
		.all();
	const { tags, last } = swaps ? swapLibrary(accountId, occ) : { tags: {}, last: {} };
	return rows.map((r) => ({ ...r, tags: tags[r.id] ?? [], last: last[r.id] ?? null }));
}

/** Why a finished log refuses a swap or Pick another: what it counted is settled. */
const FINISHED = 'This log is finished: its Tasks stay as logged.';

/** Where to go back to: a page of this app, or null. */
const safeBack = (v: string | null | undefined) => (v && /^\/(?!\/)[\w\-/.?=&%]*$/.test(v) && v.length <= 200 ? v : null);

export const load: PageServerLoad = ({ locals, params, cookies, url }) => {
	const accountId = locals.account!.id;
	const o = ownedOccurrence(accountId, params.id);
	if (!o) {
		// A group's day has no log of its own: its page shows the days and the habits inside.
		const group = groupOfOccurrence(accountId, params.id);
		if (group) redirect(303, `/habits/${group}/chain`);
		error(404, 'Not found');
	}
	const today = userToday(accountId, cookies.get('tz'));
	const past = o.occ.date < today;
	const back = safeBack(url.searchParams.get('back')) ?? (past ? `/day/${o.occ.date}` : '/');
	// A routine's day: the habits inside it are its places.
	const routine = routineSteps(accountId, params.id);
	if (routine) return { routine, today, back, canLog: !past || windowFor(accountId, o.occ.date, today) === 'ok' };
	const win = windowFor(accountId, o.occ.date, today);
	const v = o.occ.variantId
		? db.select().from(variant).where(eq(variant.id, o.occ.variantId)).get()
		: null;
	const slots = v
		? db.select().from(slot).where(eq(slot.variantId, v.id)).orderBy(asc(slot.sortOrder)).all()
		: [];
	// An auto-filled Slot of a day written as missed gets its Task now, so it can be logged.
	const picks = ensurePicks(o.occ.id) ?? {};
	const entries = db
		.select()
		.from(entry)
		.where(eq(entry.occurrenceId, o.occ.id))
		.orderBy(asc(entry.sortOrder))
		.all();

	// Ids this log holds: Tasks, fields, and the options its Choice values are; shown even when archived since.
	const kept = new Set(entries.flatMap((e) => [e.taskId, ...Object.keys(e.values ?? {}), ...Object.values(e.values ?? {}).filter((v): v is string => typeof v === 'string')]));
	const positions = positionsOf({ ...o.occ, picks }, { keep: partIdsIn(entries) });
	const placed = place(positions, entries);
	const tasks = new Map<string, ReturnType<typeof loadTask>>();
	const taskOf = (id: string) => (tasks.has(id) ? tasks.get(id)! : tasks.set(id, loadTask(id, kept)).get(id)!);
	const byPath = new Map(positions.map((p) => [p.path, p]));
	const items: LogTask[] = positions.map((p, i) => {
		const s = slots.find((x) => x.id === p.slotId);
		const t = taskOf(p.taskId);
		const head = startsRound(positions, i) && p.parent ? `${taskOf(byPath.get(p.parent)!.taskId)?.name ?? ''} · round ${p.round!.n} of ${p.round!.of}` : null;
		return {
			path: p.path,
			slotId: p.slotId,
			depth: p.depth,
			kids: p.kids,
			roundHead: head,
			open: p.depth === 0 && !!s?.fillRule,
			own: ownTask(o.occ, p.slotId, s),
			used: [],
			sets: p.sets,
			targets: p.targets ?? {},
			minTargets: p.minTargets ?? {},
			stretchTargets: p.stretchTargets ?? {},
			task: t,
			saved: (placed.at.get(p.path) ?? []).map((e) => e.values).filter((v) => !(v._summary === true && Object.keys(v).length === 1)),
			previous: lastEntries(p.taskId, o.occ.id, p.path)
		};
	});
	// An auto-filled Slot with no Task to match: shown, so it can be swapped. Only Slots of the
	// plan this log has (a log kept from before the Slots changed keeps its own).
	const plan = plannedSlots({ ...o.occ, picks }, slots);
	for (const s of plan)
		if (!s.taskId) {
			const at = items.findIndex((it) => plan.findIndex((x) => x.slotId === it.slotId) > plan.indexOf(s));
			const empty: LogTask = { path: s.slotId, slotId: s.slotId, depth: 0, kids: 0, roundHead: null, open: !!slots.find((x) => x.id === s.slotId)?.fillRule, own: null, used: [], sets: s.sets, targets: {}, minTargets: {}, stretchTargets: {}, task: null, saved: [], previous: [] };
			if (at < 0) items.push(empty);
			else items.splice(at, 0, empty);
		}
	// An open log can swap: each fixed Slot's ⋯ lists the plan's Task and up to 2 used there before. Their fields and
	// last time come along (Tasks with parts don't: their places are the server's), so a swap to one shows at once offline.
	const canLog = win === 'ok' || win === 'today';
	const alts: Record<string, { task: NonNullable<LogTask['task']>; previous: Record<string, unknown>[] }> = {};
	if (o.occ.status !== 'done' && canLog)
		for (const it of items) {
			if (it.depth || it.open || !it.own) continue;
			it.used = usedBefore(o.occ, it.slotId).filter((u) => u.taskId !== it.own && u.taskId !== it.task?.id);
			for (const id of [...(it.task?.id === it.own ? [] : [it.own]), ...it.used.slice(0, 2).map((u) => u.taskId)]) {
				const t = alts[id] || hasParts(id) ? null : taskOf(id);
				if (t) alts[id] = { task: t, previous: lastEntries(id, o.occ.id, it.slotId) };
			}
		}
	// What this log holds that no place in it shows now (a part removed, a Slot swapped):
	// sent back with every save, so it is never lost.
	const orphans = placed.orphans.map((e) => ({ taskId: e.taskId, path: e.path, values: e.values }));
	// Their Tasks' names and words, steps inside a Task too, which the Library leaves out.
	const orphanTasks = Object.fromEntries(
		[...new Set(orphans.map((e) => e.taskId))].flatMap((id) => {
			const t = db.select({ name: task.name, rowOne: task.rowOne, rowMany: task.rowMany }).from(task).where(eq(task.id, id)).get();
			return t ? [[id, t] as const] : [];
		})
	);
	// Done in a Slot before it was swapped is shown in that Slot: only what has no place shown is gone from the habit.
	const orphanNames = [...new Set(goneFrom(orphans, items).map((e) => e.taskId))].flatMap((id) => (orphanTasks[id] ? [orphanTasks[id].name] : []));

	return {
		routine: null,
		occurrence: {
			id: o.occ.id,
			date: o.occ.date,
			status: o.occ.status,
			notes: o.occ.notes ?? '',
			level: o.occ.level ?? 'target'
		},
		/** What this log holds, for telling a save made from an older version of it (see logrev.ts). */
		rev: revOf(contentOf(o.occ)),
		habitName: o.habit.name,
		habitId: o.habit.id,
		/** A past day: no autosave or timer, and Back goes to that day. */
		past,
		/** False for a past day outside the window in Settings: only a finished log can be changed. */
		canLog,
		back,
		levels: o.habit.levels?.enabled ? o.habit.levels : null,
		variantName: v?.name ?? null,
		variantId: v?.id ?? null,
		logLayouts: getSettings(accountId).logLayouts ?? {},
		/** The plan this log follows, to change where it stands: an open log of today only. */
		plan: !past && o.occ.status === 'due' && v && !v.archived ? (currentForm(accountId, o.habit.id)?.variants ?? null) : null,
		items,
		alts,
		orphans,
		orphanTasks,
		orphanNames,
		/** "Last time … · best …" per Task. */
		recap: recapFor(
			accountId,
			[...items.flatMap((it) => (it.task ? [it.task.id] : [])), ...Object.keys(alts)],
			o.occ.id,
			o.occ.date
		),
		library: libraryFor(accountId, o.occ, o.occ.status !== 'done' && canLog)
	};
};

const savePayload = z.object({
	finish: z.boolean(),
	/** Autosave and offline sync: save without leaving the page. */
	stay: z.boolean().default(false),
	notes: z.string().max(NOTE_MAX),
	level: z.enum(['minimum', 'target', 'stretch']).default('target'),
	/** Where to go after Finish on a past day. */
	back: z.string().max(200).nullish(),
	/** The versions of the log this one grew from; left out by saves queued before it existed. */
	bases: z.array(z.string().max(32)).max(40).optional(),
	entries: z.array(
		z.object({
			taskId: z.string().uuid(),
			/** Where it sits in the log (engine/parts.ts); null for one kept from before paths. */
			path: z.string().regex(PATH_RE).nullable().default(null),
			values: z.record(z.string(), z.unknown())
		})
	)
});

/** A routine's day, or a habit inside it, from the form. */
function step(event: Parameters<Actions[string]>[0], f: FormData) {
	const accountId = event.locals.account!.id;
	const day = routineDay(accountId, event.params.id ?? '');
	if (!day) error(404, 'Not found');
	const id = String(f.get('occurrence') ?? '');
	const occ = id === day.o.occ.id ? day.o.occ : day.kids.find((k) => k.occ.id === id)?.occ;
	if (!occ) error(404, 'Not found');
	// A day further back than Settings allow can only be looked at.
	const today = userToday(accountId, event.cookies.get('tz'));
	if (occ.date < today && windowFor(accountId, occ.date, today) !== 'ok') error(400, 'This day is too far back to log.');
	return { occ, actor: appActor(accountId, event.cookies.get('tz')) };
}

export const actions: Actions = {
	/** Done: a habit inside a routine, or the routine (every habit inside still open gets its one tap). */
	stepDone: async (event) => {
		const { occ, actor } = step(event, await event.request.formData());
		const { result, undo } = withRoutineUndo(occ, () => doneOcc(actor, occ, 'mark', null));
		// The routine's habits still open: one waits for its time today, or needs values first.
		return { needsInput: result === 'needsInput', undo, left: result === 'needsInput' ? leftOpen(actor, occ) : [] };
	},
	stepSkip: async (event) => {
		const { occ, actor } = step(event, await event.request.formData());
		return { undo: withRoutineUndo(occ, () => skipOcc(actor, occ)).undo };
	},
	stepUndo: async (event) => {
		const f = await event.request.formData();
		const { occ, actor } = step(event, f);
		const undo = String(f.get('undo') ?? '');
		if (undo) return undoRoutine(actor, occ, undo) ? undefined : fail(400, { error: 'Could not undo.' });
		// What one tap filled in goes again; what you logged stays. Without a word on it, the event log says.
		reopenOcc(actor, occ, f.has('clear') ? f.get('clear') === '1' : undoClears(actor, occ));
	},
	save: async ({ request, locals, params, cookies }) => {
		const o = ownedOccurrence(locals.account!.id, params.id);
		if (!o) error(404);
		const today = userToday(locals.account!.id, cookies.get('tz'));
		const past = o.occ.date < today;
		let parsed;
		try {
			parsed = savePayload.safeParse(JSON.parse(String((await request.formData()).get('payload'))));
		} catch {
			return fail(400, { error: 'Could not read the log.' });
		}
		if (!parsed.success) return fail(400, { error: 'Could not read the log.' });
		const p = parsed.data;
		// Only Tasks of this account can be logged.
		const ids = [...new Set(p.entries.map((e) => e.taskId))];
		const ok = ids.length
			? db
					.select({ id: task.id })
					.from(task)
					.where(and(inArray(task.id, ids), eq(task.accountId, locals.account!.id)))
					.all().length === ids.length
			: true;
		if (!ok) return fail(400, { error: 'Unknown task.' });
		// Settings can limit how far back a day can still be marked done; a finished log can always be corrected.
		const win = windowFor(locals.account!.id, o.occ.date, today);
		if (past && o.occ.status !== 'done' && win !== 'ok')
			return fail(400, { error: win === 'off' ? 'Logging past days is off in Settings.' : 'This day is too far back to log. You can change how far back in Settings.' });
		// Another device, a link or an assistant wrote this log since: say so instead of overwriting it.
		// Nothing is awaited between here and the write, so nothing can come in between.
		const stale = staleSave(o.occ, p, p.bases);
		if (stale) return fail(409, { error: 'This log changed on another device.', stale });
		const schedule = o.habit.schedule as ScheduleForm | null;
		const plan = past && schedule ? planOfToday(o.habit.id, schedule, today) : null;

		db.transaction((tx) => {
			tx.delete(entry).where(eq(entry.occurrenceId, o.occ.id)).run();
			p.entries.forEach((e, i) =>
				tx
					.insert(entry)
					.values({ id: randomUUID(), occurrenceId: o.occ.id, taskId: e.taskId, path: e.path, values: e.values, sortOrder: i })
					.run()
			);
			tx.update(occurrence)
				.set({
					notes: p.notes || null,
					level: p.level === 'target' ? null : p.level,
					...(p.finish ? { status: 'done' as const, finishedAt: new Date() } : {})
				})
				.where(eq(occurrence.id, o.occ.id))
				.run();
		});
		// Finished: done when it counts under the habit's rule. A log that falls short stays
		// open today, and is missed on a day that is over. Its values stay either way.
		const status = p.finish ? finishAs(o.occ.id, today) : o.occ.status;
		// The event log: finishing is a habit done; saving a finished log again is an edit.
		const actor = appActor(locals.account!.id, cookies.get('tz'));
		const ev = { habitId: o.habit.id, date: o.occ.date };
		if (p.finish && status === 'done' && o.occ.status !== 'done')
			emit(actor, 'occurrence.done', { ...ev, data: { occurrenceId: o.occ.id, level: p.level === 'target' ? null : p.level, how: 'log', entries: p.entries.length } });
		else if (o.occ.status === 'done' && (!p.stay || p.finish)) emit(actor, 'log.saved', { ...ev, data: { occurrenceId: o.occ.id, entries: p.entries.length } });
		// A past log can change what is due today (a weekly target met, a rotation moved on).
		if (past && schedule) {
			replanToday(locals.account!.id, o.habit.id, schedule, today, plan);
			if (p.finish) recount(locals.account!.id, o.habit.id, schedule, o.occ.date, today);
		}
		if (p.finish && !p.stay) {
			const from = safeBack(p.back);
			// A routine's step comes back to the routine, which says what it did.
			if (past || from?.startsWith('/log/')) {
				const back = from ?? `/day/${o.occ.date}`;
				redirect(303, `${back}${back.includes('?') ? '&' : '?'}did=${o.occ.id}`);
			}
			// Short of what counts: back on Today it shows how far it got, and stays open.
			if (status !== 'done') redirect(303, `/?did=${o.occ.id}&short=${o.habit.minimumCounts ? 'minimum' : 'target'}`);
			redirect(303, `/?did=${o.occ.id}&finished=${o.habit.id}`);
		}
		return { saved: true, status };
	},

	/** Pick a different Task for an auto-filled Slot. */
	reroll: async ({ request, locals, params, cookies }) => {
		const o = ownedOccurrence(locals.account!.id, params.id);
		if (!o || !o.occ.variantId) error(404);
		if (o.occ.status === 'done') return fail(400, { error: FINISHED });
		const slotId = String((await request.formData()).get('slot'));
		try {
			rerollSlot(appActor(locals.account!.id, cookies.get('tz')), o.occ, slotId);
		} catch (e) {
			if (!(e instanceof ActionError)) throw e;
			if (e.code === 'not_found') error(404);
			return fail(400, { error: e.message });
		}
	},

	/**
	 * What a Task would aim for as a fixed Slot's own (Keep in the plan, Replace…), by aimFor: from `today`, what it
	 * logged in the Slot today (sent, since it may not be saved yet), else its last time. The page then changes the plan.
	 */
	aim: async ({ request, locals, params }) => {
		const accountId = locals.account!.id;
		const o = ownedOccurrence(accountId, params.id);
		if (!o || !o.occ.variantId) error(404);
		const f = await request.formData();
		const s = db.select().from(slot).where(and(eq(slot.id, String(f.get('slot'))), eq(slot.variantId, o.occ.variantId))).get();
		const t = db.select({ id: task.id }).from(task).where(and(eq(task.id, String(f.get('task'))), eq(task.accountId, accountId), isNull(task.deleteAfter), isNull(task.parentTaskId))).get();
		if (!s || !t) error(404);
		// An auto-filled Slot keeps its Fill rule: a Task is pinned there in the habit's editor.
		if (!s.taskId || s.fillRule) return fail(400, { error: 'An auto-filled Slot picks its Task by its rule.' });
		let today: Record<string, unknown>[] = [];
		try {
			today = z.array(z.record(z.string(), z.unknown())).max(200).parse(JSON.parse(String(f.get('today') ?? '[]')));
		} catch {
			/* nothing logged today that it can read: its last time */
		}
		const fields = (id: string) => db.select().from(metric).where(and(eq(metric.taskId, id), eq(metric.archived, false))).orderBy(asc(metric.sortOrder)).all();
		const to = fields(t.id);
		const targets = aimFor(fields(s.taskId), s.targets ?? {}, to, today, lastEntries(t.id, o.occ.id, s.id));
		return { targets, aim: aimText(s.sets, to, targets) };
	},

	/** Use a Task of your choice in a Slot, for this Occurrence only; an empty `task` takes an auto-filled Slot's pick away. */
	swap: async ({ request, locals, params, cookies }) => {
		const o = ownedOccurrence(locals.account!.id, params.id);
		if (!o || !o.occ.variantId) error(404);
		// A band's Undo can still reach it after Finish.
		if (o.occ.status === 'done') return fail(400, { error: FINISHED });
		const f = await request.formData();
		try {
			swapSlot(appActor(locals.account!.id, cookies.get('tz')), o.occ, String(f.get('slot')), String(f.get('task') ?? '') || null);
		} catch (e) {
			if (!(e instanceof ActionError)) throw e;
			if (e.code === 'not_found') error(404);
			return fail(400, { error: e.message });
		}
	}
};
