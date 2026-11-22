// A routine's day: the habits inside it that are due, in order, each logged on its own (its
// values land in its own log) and the routine judged from them. Done, Skip and Undo work per
// habit or for the whole routine at once.
import { error, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { slot } from '$lib/server/db/schema';
import { ownedOccurrence } from '$lib/server/owned';
import { isRoutine, kidsOn } from '$lib/server/rollup';
import { userToday } from '$lib/server/today';
import { progressForIds } from '$lib/server/progress';
import { progressText } from '$lib/engine/progress';
import { rollupText } from '$lib/engine/rollup';
import { appActor } from '$lib/server/core/actor';
import { doneOcc, reopenOcc, skipOcc } from '$lib/server/core/log';
import type { Actions, PageServerLoad } from './$types';

/** The routine's day and the habits inside it due that day, or null when it isn't one. */
function routineDay(accountId: string, occurrenceId: string) {
	const o = ownedOccurrence(accountId, occurrenceId);
	if (!o || !isRoutine(o.habit.id, o.occ.date)) return null;
	const kids = kidsOn(o.habit.id, o.occ.date).filter((k) => !k.occ.extra);
	if (!kids.length) return null;
	return { o, kids };
}

export const load: PageServerLoad = ({ locals, params, cookies }) => {
	const accountId = locals.account!.id;
	const day = routineDay(accountId, params.id);
	if (!day) {
		// Nothing inside is due that day: it is ticked off like any habit.
		if (ownedOccurrence(accountId, params.id)) redirect(303, `/log/${params.id}`);
		error(404, 'Not found');
	}
	const { o, kids } = day;
	const progress = progressForIds(kids.map((k) => k.occ.id));
	const here = `/routine/${o.occ.id}`;
	return {
		routine: {
			occurrenceId: o.occ.id,
			habitId: o.habit.id,
			name: o.habit.name,
			date: o.occ.date,
			status: o.occ.status,
			level: o.occ.level,
			count: o.occ.rollup && o.occ.status !== 'skipped' ? rollupText(o.occ.rollup) : null
		},
		today: userToday(accountId, cookies.get('tz')),
		here,
		kids: kids.map((k) => {
			const p = progress.get(k.occ.id);
			return {
				occurrenceId: k.occ.id,
				habitId: k.habit.id,
				name: k.habit.name,
				status: k.occ.status,
				level: k.occ.level,
				progress: p ? progressText(p) : null,
				/** A habit with Tasks opens its own log; one without is ticked off here. */
				hasTasks: !!(k.occ.variantId && db.select({ id: slot.id }).from(slot).where(eq(slot.variantId, k.occ.variantId)).get()),
				log: `/log/${k.occ.id}?back=${encodeURIComponent(here)}`
			};
		})
	};
};

/** An Occurrence of the routine or of a habit inside it, from the form. */
function target(event: Parameters<Actions[string]>[0], f: FormData) {
	const accountId = event.locals.account!.id;
	const day = routineDay(accountId, event.params.id);
	if (!day) error(404, 'Not found');
	const id = String(f.get('occurrence') ?? '');
	const occ = id === day.o.occ.id ? day.o.occ : day.kids.find((k) => k.occ.id === id)?.occ;
	if (!occ) error(404, 'Not found');
	return { occ, actor: appActor(accountId, event.cookies.get('tz')) };
}

export const actions: Actions = {
	/** Done: a habit inside, or the routine (every habit inside still open gets its one tap). */
	done: async (event) => {
		const { occ, actor } = target(event, await event.request.formData());
		const r = doneOcc(actor, occ, 'mark', null);
		return { did: occ.id, needsInput: r === 'needsInput' };
	},
	skip: async (event) => {
		const { occ, actor } = target(event, await event.request.formData());
		skipOcc(actor, occ);
		return { did: occ.id };
	},
	undo: async (event) => {
		const { occ, actor } = target(event, await event.request.formData());
		reopenOcc(actor, occ, false);
		return { did: occ.id };
	}
};
