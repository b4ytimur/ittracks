// Quick-log links for shortcuts, bookmarks, NFC tags and QR codes: /q/<habit id or name>.
// Signed in with no options it opens today's quick log; ?go=1 logs "Same as last time" at
// once; ?value=250 (with &field=… when the habit has several numbers) adds a value. With a
// key (?key=itk_…) it works without signing in and answers on this page; see core/quick.ts. Signed
// in, the answer is in the band on Today.
import { redirect } from '@sveltejs/kit';
import { ensureToday, userToday } from '$lib/server/today';
import { db } from '$lib/server/db';
import { slot } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { ScheduleForm } from '$lib/forms';
import { ActionError, appActor } from '$lib/server/core/actor';
import { findHabit } from '$lib/server/core/day';
import { doneOcc } from '$lib/server/core/log';
import { logsSomething, once, quickLog, quickParams, type QuickOutcome } from '$lib/server/core/quick';
import { setFlash, type Flash } from '$lib/server/flash';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, url, cookies }) => {
	const accountId = locals.account!.id;
	const actor = locals.actor ?? appActor(accountId, cookies.get('tz'));
	const viaKey = actor.source === 'link';
	const p = quickParams((k) => url.searchParams.get(k));
	/** Signed in, every answer is on Today; a link opened with a key alone answers here. */
	const answer = (f: Flash): { name: string; ok: boolean; message: string } => {
		if (viaKey) return { name: h?.name ?? params.habit, ok: f.kind !== 'error', message: f.text };
		setFlash(cookies, f, url.protocol === 'https:');
		redirect(303, '/');
	};
	let h: ReturnType<typeof findHabit> | undefined;
	try {
		h = findHabit(actor, params.habit);
	} catch (e) {
		if (e instanceof ActionError) return answer({ kind: 'error', text: e.message });
		throw e;
	}

	if (viaKey || logsSomething(p)) {
		let out: QuickOutcome;
		try {
			const run = () => quickLog(actor, h!.id, p);
			out = viaKey ? once(`${actor.tokenId}|${url.pathname}|${url.search}`, run) : run();
		} catch (e) {
			if (!(e instanceof ActionError)) throw e;
			// Not due: it can be logged anyway.
			const [text, how] = e.message.split(' To log it anyway');
			return answer(e.code === 'not_due' ? { kind: 'notDue', text, ...(how ? { habit: h.id } : {}) } : { kind: 'error', text: e.message });
		}
		if (viaKey) return answer({ kind: 'did', text: out.message });
		if (out.needsInput && out.occurrenceId) redirect(303, `/log/${out.occurrenceId}?quick`);
		// Already done: say so instead of offering an Undo that would wipe that log.
		if ((out.result as { already?: boolean }).already) return answer({ kind: 'already', text: out.message, occurrence: out.occurrenceId ?? undefined });
		// Undo after a one-tap done also clears what it logged; after adding a value it only reopens.
		return answer({ kind: 'did', text: out.message, occurrence: out.occurrenceId ?? undefined, clear: p.value === null });
	}

	if (h.direction === 'break') redirect(303, '/');
	const occ = h.schedule ? ensureToday(accountId, h.id, h.schedule as ScheduleForm, userToday(accountId, cookies.get('tz'))) : null;
	if (!occ) return answer({ kind: 'notDue', text: `${h.name} isn't due today.`, habit: h.id });
	if (occ.status !== 'due') return answer({ kind: 'already', text: `${h.name} is already ${occ.status} today.`, occurrence: occ.id });
	const hasSlots = !!(occ.variantId && db.select({ id: slot.id }).from(slot).where(eq(slot.variantId, occ.variantId)).get());
	if (!hasSlots) {
		doneOcc(actor, occ, 'targets', null);
		return answer({ kind: 'did', text: `${h.name}: done`, occurrence: occ.id, clear: true });
	}
	redirect(303, `/log/${occ.id}?quick`);
};
