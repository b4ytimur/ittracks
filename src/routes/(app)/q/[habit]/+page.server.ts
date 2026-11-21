// Quick-log links for shortcuts, bookmarks and QR codes: /q/<habit id>.
// Opens today's quick log; with ?go=1 it logs "Same as last time" straight away.
import { error, redirect } from '@sveltejs/kit';
import { ownedHabit } from '$lib/server/owned';
import { ensureToday, quickDone, sameAsLast, userToday } from '$lib/server/today';
import { db } from '$lib/server/db';
import { slot } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { ScheduleForm } from '$lib/forms';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, url, cookies }) => {
	const accountId = locals.account!.id;
	const h = ownedHabit(accountId, params.habit);
	if (!h) error(404, 'Habit not found');
	if (h.direction === 'break') redirect(303, '/');
	const occ = h.schedule ? ensureToday(accountId, h.id, h.schedule as ScheduleForm, userToday(accountId, cookies.get('tz'))) : null;
	if (!occ) return { name: h.name, state: 'notDue' as const };
	if (occ.status !== 'due') return { name: h.name, state: occ.status, occurrenceId: occ.id };
	const hasSlots = !!(occ.variantId && db.select({ id: slot.id }).from(slot).where(eq(slot.variantId, occ.variantId)).get());
	if (url.searchParams.get('go') === '1') {
		const r = hasSlots ? sameAsLast(occ.id) : quickDone(occ.id, null);
		if (r === 'needsInput') redirect(303, `/log/${occ.id}?quick`);
		redirect(303, `/?did=${occ.id}&clear=1`);
	}
	if (!hasSlots) {
		quickDone(occ.id, null);
		redirect(303, `/?did=${occ.id}&clear=1`);
	}
	redirect(303, `/log/${occ.id}?quick`);
};
