import { randomUUID } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { entry, metric, occurrence, slot, task, variant } from '$lib/server/db/schema';
import { groupOfOccurrence, ownedOccurrence } from '$lib/server/owned';
import { currentForm } from '$lib/server/habit-patch';
import { candidates, ensurePicks, lastEntries, recount, userToday } from '$lib/server/today';
import { finishAs } from '$lib/server/progress';
import { PATH_RE, place, startsRound } from '$lib/engine/parts';
import { partIdsIn, plannedSlots, positionsOf } from '$lib/server/positions';
import { getGroups, getSettings, getUnits } from '$lib/server/settings';
import { recapFor } from '$lib/server/stats';
import { planOfToday, replanToday, windowFor } from '$lib/server/backfill';
import { NOTE_MAX, type ScheduleForm } from '$lib/forms';
import { pickTask, type FillRule } from '$lib/engine/fill';
import { appActor } from '$lib/server/core/actor';
import { emit } from '$lib/server/core/events';
import { isRoutine, kidsOn } from '$lib/server/rollup';
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
	// A routine's day with habits inside it is run from its own page.
	if (isRoutine(o.habit.id, o.occ.date) && kidsOn(o.habit.id, o.occ.date).some((k) => !k.occ.extra)) redirect(303, `/routine/${o.occ.id}`);
	const today = userToday(accountId, cookies.get('tz'));
	const past = o.occ.date < today;
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
			const empty: LogTask = { path: s.slotId, slotId: s.slotId, depth: 0, kids: 0, roundHead: null, open: !!slots.find((x) => x.id === s.slotId)?.fillRule, sets: s.sets, targets: {}, minTargets: {}, stretchTargets: {}, task: null, saved: [], previous: [] };
			if (at < 0) items.push(empty);
			else items.splice(at, 0, empty);
		}
	// What this log holds that no place in it shows now (a part removed, a Slot swapped):
	// sent back with every save, so it is never lost.
	const orphans = placed.orphans.map((e) => ({ taskId: e.taskId, path: e.path, values: e.values }));
	const orphanNames = [...new Set(orphans.map((e) => e.taskId))]
		.map((id) => db.select({ name: task.name }).from(task).where(eq(task.id, id)).get()?.name)
		.filter((n): n is string => !!n);

	return {
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
		canLog: win === 'ok' || win === 'today',
		back: safeBack(url.searchParams.get('back')) ?? (past ? `/day/${o.occ.date}` : '/'),
		weightUnit: getUnits(accountId).shown('weight'),
		levels: o.habit.levels?.enabled ? o.habit.levels : null,
		variantName: v?.name ?? null,
		/** The plan this log follows, to change where it stands: an open log of today only. */
		plan: !past && o.occ.status === 'due' && v && !v.archived ? (currentForm(accountId, o.habit.id)?.variants ?? null) : null,
		items,
		orphans,
		orphanNames,
		/** "Last time … · best …" per Task. */
		recap: recapFor(
			accountId,
			items.flatMap((it) => (it.task ? [it.task.id] : [])),
			o.occ.id,
			getUnits(accountId).shown('weight'),
			o.occ.date
		),
		library: db
			.select({ id: task.id, name: task.name })
			.from(task)
			.where(and(eq(task.accountId, accountId), isNull(task.parentTaskId)))
			.orderBy(asc(task.name))
			.all()
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

export const actions: Actions = {
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
			if (past) {
				const back = safeBack(p.back) ?? `/day/${o.occ.date}`;
				redirect(303, `${back}${back.includes('?') ? '&' : '?'}did=${o.occ.id}`);
			}
			// Short of what counts: back on Today it shows how far it got, and stays open.
			if (status !== 'done') redirect(303, `/?did=${o.occ.id}&short=${o.habit.minimumCounts ? 'minimum' : 'target'}`);
			redirect(303, `/?did=${o.occ.id}&finished=${o.habit.id}`);
		}
		return { saved: true, status };
	},

	/** Pick a different Task for an auto-filled Slot. */
	reroll: async ({ request, locals, params }) => {
		const o = ownedOccurrence(locals.account!.id, params.id);
		if (!o || !o.occ.variantId) error(404);
		const slotId = String((await request.formData()).get('slot'));
		const s = db.select().from(slot).where(and(eq(slot.id, slotId), eq(slot.variantId, o.occ.variantId))).get();
		if (!s?.fillRule) error(404);
		const picks = { ...(o.occ.picks ?? {}) };
		// Exclude every Task already in this Occurrence, including the current pick.
		const fixed = db
			.select({ taskId: slot.taskId })
			.from(slot)
			.where(eq(slot.variantId, o.occ.variantId))
			.all()
			.map((x) => x.taskId)
			.filter((x): x is string => !!x);
		const used = new Set([...Object.values(picks), ...fixed]);
		const next = pickTask(s.fillRule as FillRule, candidates(locals.account!.id), getGroups(locals.account!.id).rank, used);
		if (!next) return fail(400, { error: 'No other Task matches this slot.' });
		picks[s.id] = next;
		db.update(occurrence).set({ picks }).where(eq(occurrence.id, o.occ.id)).run();
	},

	/** Use a Task of your choice in a Slot, for this Occurrence only. */
	swap: async ({ request, locals, params }) => {
		const o = ownedOccurrence(locals.account!.id, params.id);
		if (!o || !o.occ.variantId) error(404);
		const f = await request.formData();
		const slotId = String(f.get('slot'));
		const taskId = String(f.get('task'));
		const s = db.select().from(slot).where(and(eq(slot.id, slotId), eq(slot.variantId, o.occ.variantId))).get();
		const t = db.select().from(task).where(and(eq(task.id, taskId), eq(task.accountId, locals.account!.id))).get();
		if (!s || !t) error(404);
		db.update(occurrence)
			.set({ picks: { ...(o.occ.picks ?? {}), [s.id]: t.id } })
			.where(eq(occurrence.id, o.occ.id))
			.run();
	}
};
