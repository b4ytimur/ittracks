// The Journal page (J2): everything written, by day. Journal fields, log notes, slip notes
// and the day note, with search, a habit and a mood filter, and "On this day". The journal
// itself stays a normal habit; this is a read view over what exists, like History.
import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { metric, task } from '$lib/server/db/schema';
import { getSettings, getViews, saveSettings } from '$lib/server/settings';
import { userToday } from '$lib/server/today';
import { getDayNote, loadJournal, saveDayNote } from '$lib/server/journal';
import { addTemplate } from '$lib/server/repo/templates';
import { galleryItem } from '$lib/gallery';
import { addDays, daysBetween } from '$lib/engine/dates';
import { isRealDate } from '$lib/engine/backfill';
import { matches, onThisDay } from '$lib/journal';
import { isHidden } from '$lib/views';
import { NOTE_MAX } from '$lib/forms';
import type { Actions, PageServerLoad } from './$types';

const DAYS = 90;

/** Does the account already have a habit with a long text field (a journal)? */
function hasJournal(accountId: string): boolean {
	return !!db
		.select({ id: metric.id })
		.from(metric)
		.innerJoin(task, eq(metric.taskId, task.id))
		.where(and(eq(task.accountId, accountId), eq(metric.long, true), eq(task.archived, false)))
		.get();
}

export const load: PageServerLoad = ({ locals, cookies, url }) => {
	const accountId = locals.account!.id;
	const settings = getSettings(accountId);
	const today = userToday(accountId, cookies.get('tz'));
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
	const habit = url.searchParams.get('habit') ?? '';
	const mood = url.searchParams.get('mood') ?? '';
	const filtered = !!(q || habit || mood);
	// A search looks through everything; browsing shows the last few months.
	const days = filtered ? 3650 : Math.min(Number(url.searchParams.get('days')) || DAYS, 3650);
	const all = loadJournal(accountId, { from: addDays(today, -days), to: today }, { today });

	const shown = all
		.map((d) => (habit ? { ...d, items: d.items.filter((i) => i.habitId === habit) } : d))
		.filter((d) => (!habit || d.items.length) && (!mood || d.moods.some((m) => m.value === mood)) && matches(d, q));

	const lookBack = filtered
		? []
		: onThisDay(today)
				.map((x) => ({
					...x,
					day: loadJournal(accountId, { from: x.date, to: x.date }, { today })[0] ?? null,
					// Far enough back for the day to be on the page.
					href: `?days=${Math.max(days, daysBetween(x.date, today) + 1)}#d-${x.date}`
				}))
				.filter((x) => x.day);

	return {
		today,
		off: isHidden(getViews(accountId), 'journal'),
		dayNote: settings.dayNote ? getDayNote(accountId, today) : null,
		days: shown,
		lookBack,
		range: days,
		filters: { q, habit, mood },
		filtered,
		/** Filter choices from what was written. */
		habits: [...new Map(all.flatMap((d) => d.items.filter((i) => i.habitId).map((i) => [i.habitId!, i.habit ?? ''] as const))).entries()]
			.map(([id, name]) => ({ id, name }))
			.sort((a, b) => a.name.localeCompare(b.name)),
		moods: [...new Set(all.flatMap((d) => d.moods.map((m) => m.value)))],
		/** J7: offer the setup when there is no journal yet, or when asked. */
		setup: url.searchParams.has('setup') || (!all.length && !hasJournal(accountId) && !settings.dayNote),
		hasJournal: hasJournal(accountId),
		dayNoteOn: settings.dayNote
	};
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
			const item = galleryItem('journaling', getSettings(accountId).weightUnit);
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
		redirect(303, `/journal?ready=${wantHabit ? 'habit' : ''}${wantNote ? 'note' : ''}`);
	}
};
