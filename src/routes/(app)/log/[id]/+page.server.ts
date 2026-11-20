import { randomUUID } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { entry, metric, occurrence, slot, task, variant } from '$lib/server/db/schema';
import { ownedOccurrence } from '$lib/server/owned';
import { candidates, lastEntries } from '$lib/server/today';
import { pickTask, type FillRule } from '$lib/engine/fill';
import type { Actions, PageServerLoad } from './$types';

export interface LogTask {
	slotId: string;
	open: boolean;
	sets: number | null;
	targets: Record<string, number>;
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
		}[];
		subtasks: { id: string; name: string }[];
	} | null;
	saved: Record<string, unknown>[];
	previous: Record<string, unknown>[];
}

function loadTask(id: string) {
	const t = db.select().from(task).where(eq(task.id, id)).get();
	if (!t) return null;
	return {
		id: t.id,
		name: t.name,
		restTimerEnabled: t.restTimerEnabled,
		restTimerSeconds: t.restTimerSeconds,
		metrics: db
			.select()
			.from(metric)
			.where(eq(metric.taskId, id))
			.orderBy(asc(metric.sortOrder))
			.all()
			.map(({ id, name, type, unit, repeats, choices }) => ({ id, name, type, unit, repeats, choices })),
		subtasks: db
			.select({ id: task.id, name: task.name })
			.from(task)
			.where(eq(task.parentTaskId, id))
			.orderBy(asc(task.sortOrder))
			.all()
	};
}

export const load: PageServerLoad = ({ locals, params }) => {
	const accountId = locals.account!.id;
	const o = ownedOccurrence(accountId, params.id);
	if (!o) error(404, 'Not found');
	const v = o.occ.variantId
		? db.select().from(variant).where(eq(variant.id, o.occ.variantId)).get()
		: null;
	const slots = v
		? db.select().from(slot).where(eq(slot.variantId, v.id)).orderBy(asc(slot.sortOrder)).all()
		: [];
	const picks = o.occ.picks ?? {};
	const entries = db
		.select()
		.from(entry)
		.where(eq(entry.occurrenceId, o.occ.id))
		.orderBy(asc(entry.sortOrder))
		.all();

	const items: LogTask[] = slots.map((s) => {
		const taskId = picks[s.id] ?? s.taskId;
		return {
			slotId: s.id,
			open: !!s.fillRule,
			sets: s.sets,
			targets: s.targets ?? {},
			task: taskId ? loadTask(taskId) : null,
			saved: entries.filter((e) => e.taskId === taskId).map((e) => e.values),
			previous: taskId ? lastEntries(taskId, o.occ.id) : []
		};
	});

	// Sub-task ticks are saved as Entries of the sub-task itself.
	const subDone = Object.fromEntries(entries.map((e) => [e.taskId, true]));

	return {
		occurrence: {
			id: o.occ.id,
			date: o.occ.date,
			status: o.occ.status,
			notes: o.occ.notes ?? ''
		},
		habitName: o.habit.name,
		variantName: v?.name ?? null,
		items,
		subDone,
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
	notes: z.string().max(5000),
	entries: z.array(
		z.object({ taskId: z.string().uuid(), values: z.record(z.string(), z.unknown()) })
	)
});

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const o = ownedOccurrence(locals.account!.id, params.id);
		if (!o) error(404);
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
					...(p.finish ? { status: 'done' as const, finishedAt: new Date() } : {})
				})
				.where(eq(occurrence.id, o.occ.id))
				.run();
		});
		if (p.finish) redirect(303, '/');
		return { saved: true };
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
