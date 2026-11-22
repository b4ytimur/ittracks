// Quick-log links for shortcuts, bookmarks, NFC tags and QR codes: /q/<habit id or name>.
// Signed in with no options it opens today's quick log; ?go=1 logs "Same as last time" at
// once; ?value=250 (with &field=… when the habit has several numbers) adds a value. With a
// key (?key=itk_…) it works without signing in and answers on this page; see core/quick.ts.
import { redirect } from '@sveltejs/kit';
import { ensureToday, userToday } from '$lib/server/today';
import { db } from '$lib/server/db';
import { slot } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { ScheduleForm } from '$lib/forms';
import { ActionError, appActor } from '$lib/server/core/actor';
import { findHabit } from '$lib/server/core/day';
import { doneOcc } from '$lib/server/core/log';
import { logsSomething, once, quickLog, quickParams } from '$lib/server/core/quick';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, url, cookies }) => {
	const accountId = locals.account!.id;
	const actor = locals.actor ?? appActor(accountId, cookies.get('tz'));
	const viaKey = actor.source === 'link';
	const p = quickParams((k) => url.searchParams.get(k));
	let h;
	try {
		h = findHabit(actor, params.habit);
	} catch (e) {
		if (e instanceof ActionError) return { name: params.habit, state: 'error' as const, message: e.message };
		throw e;
	}

	if (viaKey || logsSomething(p)) {
		try {
			const run = () => quickLog(actor, h.id, p);
			const out = viaKey ? once(`${actor.tokenId}|${url.pathname}|${url.search}`, run) : run();
			if (!viaKey) {
				if (out.needsInput && out.occurrenceId) redirect(303, `/log/${out.occurrenceId}?quick`);
				// Already done: say so instead of offering an Undo that would wipe that log.
				if ((out.result as { already?: boolean }).already) return { name: h.name, state: 'done' as const, occurrenceId: out.occurrenceId };
				// Undo after a one-tap done also clears what it logged; after adding a value it only reopens.
				redirect(303, out.occurrenceId ? `/?did=${out.occurrenceId}${p.value === null ? '&clear=1' : ''}` : '/');
			}
			return { name: h.name, state: 'logged' as const, message: out.message };
		} catch (e) {
			if (e instanceof ActionError) return { name: h.name, state: 'error' as const, message: e.message };
			throw e;
		}
	}

	if (h.direction === 'break') redirect(303, '/');
	const occ = h.schedule ? ensureToday(accountId, h.id, h.schedule as ScheduleForm, userToday(accountId, cookies.get('tz'))) : null;
	if (!occ) return { name: h.name, state: 'notDue' as const };
	if (occ.status !== 'due') return { name: h.name, state: occ.status, occurrenceId: occ.id };
	const hasSlots = !!(occ.variantId && db.select({ id: slot.id }).from(slot).where(eq(slot.variantId, occ.variantId)).get());
	if (!hasSlots) {
		doneOcc(actor, occ, 'targets', null);
		redirect(303, `/?did=${occ.id}&clear=1`);
	}
	redirect(303, `/log/${occ.id}?quick`);
};
