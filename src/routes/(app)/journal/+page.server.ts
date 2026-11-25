// The Journal is History with notes only. This address keeps working for bookmarks, and its
// actions for the day note (also sent by the offline outbox) and the journal's setup.
import { error, fail, redirect } from '@sveltejs/kit';
import { getSettings, getUnits, getViews, saveSettings } from '$lib/server/settings';
import { userToday } from '$lib/server/today';
import { saveDayNote } from '$lib/server/journal';
import { addTemplate } from '$lib/server/repo/templates';
import { galleryItem } from '$lib/gallery';
import { isRealDate } from '$lib/engine/backfill';
import { NOTE_MAX } from '$lib/forms';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const to = new URLSearchParams(url.searchParams);
	to.set('notes', '');
	redirect(303, `/history?${to}`);
};

export const actions: Actions = {
	/** Save the day note (also sent by the offline outbox, so it replaces the whole note). */
	dayNote: async ({ request, locals, cookies }) => {
		if (!locals.account) error(401, 'Sign in first');
		const accountId = locals.account.id;
		const f = await request.formData();
		const date = String(f.get('date') ?? '');
		const text = String(f.get('text') ?? '');
		if (!isRealDate(date)) error(400, 'Not a date');
		if (date > userToday(accountId, cookies.get('tz'))) return fail(400, { error: "A day note can't be written ahead." });
		if (text.length > NOTE_MAX) return fail(400, { error: `Keep a day note to ${NOTE_MAX.toLocaleString()} characters.` });
		saveDayNote(accountId, date, text);
		return { saved: true };
	},

	/** J7: "Do you want a daily journal?" Adds the Journaling habit and/or turns on the day note. */
	setup: async ({ request, locals, cookies }) => {
		if (!locals.account) error(401, 'Sign in first');
		const accountId = locals.account.id;
		const f = await request.formData();
		const wantHabit = f.get('habit') === 'on';
		const wantNote = f.get('dayNote') === 'on';
		if (!wantHabit && !wantNote) return fail(400, { error: 'Pick at least one, or skip this.' });
		if (wantHabit) {
			const item = galleryItem('journaling', getUnits(accountId));
			if (!item) return fail(500, { error: 'The Journaling template is missing.' });
			const r = addTemplate(accountId, item.template, { today: userToday(accountId, cookies.get('tz')), reuse: true });
			if ('error' in r) return fail(400, { error: r.error });
		}
		if (wantNote) {
			saveSettings(accountId, { dayNote: true });
			// The day note lives in the Journal feature: switching it on brings the feature back.
			const views = getViews(accountId);
			if (views.hidden.includes('journal')) saveSettings(accountId, { views: { ...views, hidden: views.hidden.filter((h) => h !== 'journal') } });
		}
		redirect(303, `/history?notes&ready=${wantHabit ? 'habit' : ''}${wantNote ? 'note' : ''}`);
	}
};
