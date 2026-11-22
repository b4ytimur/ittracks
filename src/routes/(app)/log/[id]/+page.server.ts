import { randomUUID } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { entry, metric, occurrence, slot, task, variant } from '$lib/server/db/schema';
import { groupOfOccurrence, ownedOccurrence } from '$lib/server/owned';
import { candidates, ensurePicks, lastEntries, recount, userToday } from '$lib/server/today';
import { finishAs, goalsOf } from '$lib/server/progress';
import { slotGroups } from '$lib/engine/groups';
import { getSettings } from '$lib/server/settings';
import { recapFor } from '$lib/server/stats';
import { planOfToday, replanToday, windowFor } from '$lib/server/backfill';
import { NOTE_MAX, type ScheduleForm } from '$lib/forms';
import { pickTask, type FillRule } from '$lib/engine/fill';
import { appActor } from '$lib/server/core/actor';
import { emit } from '$lib/server/core/events';
import type { Actions, PageServerLoad } from './$types';

export interface LogTask {
	slotId: string;
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
		metrics: {
			id: string;
			name: string;
			type: string;
			unit: string | null;
			repeats: boolean;
			choices: string[] | null;
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
		subtasks: { id: string; name: string }[];
	} | null;
	saved: Record<string, unknown>[];
	previous: Record<string, unknown>[];
	/** Sub-tasks ticked last time. */
	previousSubs: string[];
}

/**
 * A Task as the log screen shows it. Archived fields and sub-tasks are left out, except those
 * this log already has a value or tick for (`kept`), so a past log shows and saves them as they are.
 */
function loadTask(id: string, kept: Set<string>) {
	const t = db.select().from(task).where(eq(task.id, id)).get();
	if (!t) return null;
	return {
		id: t.id,
		name: t.name,
		restTimerEnabled: t.restTimerEnabled,
		restTimerSeconds: t.restTimerSeconds,
		notes: t.notes ?? '',
		metrics: db
			.select()
			.from(metric)
			.where(eq(metric.taskId, id))
			.orderBy(asc(metric.sortOrder))
			.all()
			.filter((m) => !m.archived || kept.has(m.id))
			.map(({ id, name, type, unit, repeats, choices, prefill, step, required, quick, long, starter, prompts, promptOrder }) => ({
				id,
				name,
				type,
				unit,
				repeats,
				choices,
				prefill,
				step,
				required,
				quick,
				long: type === 'text' && long,
				starter: starter ?? '',
				prompts: prompts ?? [],
				promptOrder
			})),
		subtasks: db
			.select({ id: task.id, name: task.name, archived: task.archived })
			.from(task)
			.where(eq(task.parentTaskId, id))
			.orderBy(asc(task.sortOrder))
			.all()
			.filter((x) => !x.archived || kept.has(x.id))
			.map(({ id, name }) => ({ id, name }))
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

	// Fields and sub-tasks this log already holds: shown even when archived since.
	const kept = new Set(entries.flatMap((e) => [e.taskId, ...Object.keys(e.values ?? {})]));
	// The same Task in two Slots: each Slot gets its own group of Entries, not both.
	const nth = new Map<string, number>();
	const items: LogTask[] = slots.map((s) => {
		const taskId = picks[s.id] ?? s.taskId;
		const t = taskId ? loadTask(taskId, kept) : null;
		const n = taskId ? (nth.get(taskId) ?? 0) : 0;
		if (taskId) nth.set(taskId, n + 1);
		const twice = !!taskId && slots.filter((x) => (picks[x.id] ?? x.taskId) === taskId).length > 1;
		const mine = entries.filter((e) => e.taskId === taskId);
		// What this log aimed for: the targets kept with it when they changed later.
		const g = goalsOf(s, o.occ);
		return {
			slotId: s.id,
			open: !!s.fillRule,
			sets: o.occ.goals?.[s.id]?.sets ?? s.sets,
			targets: g.targets ?? {},
			minTargets: g.minTargets ?? {},
			stretchTargets: g.stretchTargets ?? {},
			task: t,
			saved: (twice ? (slotGroups(mine, taskId!)[n] ?? []) : mine).map((e) => e.values).filter((v) => !(v._summary === true && Object.keys(v).length === 1)),
			previous: taskId ? lastEntries(taskId, o.occ.id) : [],
			previousSubs: (t?.subtasks ?? []).filter((sub) => lastEntries(sub.id, o.occ.id).length).map((sub) => sub.id)
		};
	});

	// Sub-task ticks are saved as Entries of the sub-task itself.
	const subDone = Object.fromEntries(entries.map((e) => [e.taskId, true]));

	return {
		occurrence: {
			id: o.occ.id,
			date: o.occ.date,
			status: o.occ.status,
			notes: o.occ.notes ?? '',
			level: o.occ.level ?? 'target'
		},
		habitName: o.habit.name,
		habitId: o.habit.id,
		/** A past day: no autosave or timer, and Back goes to that day. */
		past,
		/** False for a past day outside the window in Settings: only a finished log can be changed. */
		canLog: win === 'ok' || win === 'today',
		back: safeBack(url.searchParams.get('back')) ?? (past ? `/day/${o.occ.date}` : '/'),
		weightUnit: getSettings(accountId).weightUnit,
		levels: o.habit.levels?.enabled ? o.habit.levels : null,
		variantName: v?.name ?? null,
		items,
		subDone,
		/** "Last time … · best …" per Task. */
		recap: recapFor(
			accountId,
			items.flatMap((it) => (it.task ? [it.task.id] : [])),
			o.occ.id,
			getSettings(accountId).weightUnit,
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
	entries: z.array(
		z.object({ taskId: z.string().uuid(), values: z.record(z.string(), z.unknown()) })
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
		const schedule = o.habit.schedule as ScheduleForm | null;
		const plan = past && schedule ? planOfToday(o.habit.id, schedule, today) : null;

		db.transaction((tx) => {
			tx.delete(entry).where(eq(entry.occurrenceId, o.occ.id)).run();
			p.entries.forEach((e, i) =>
				tx
					.insert(entry)
					.values({ id: randomUUID(), occurrenceId: o.occ.id, taskId: e.taskId, values: e.values, sortOrder: i })
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
		else if (o.occ.status === 'done' && !p.stay) emit(actor, 'log.saved', { ...ev, data: { occurrenceId: o.occ.id, entries: p.entries.length } });
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
		const next = pickTask(s.fillRule as FillRule, candidates(locals.account!.id), used);
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
