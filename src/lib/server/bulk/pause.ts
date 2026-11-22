// pause: pause the selected habits for a date range, as the habit editor's Pause does: paused
// days are not due, and a pause over past days takes back the misses counted for them.
import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { pause } from '../db/schema';
import { pausesOf, repaused } from '../today';
import { ActionError } from '../core/actor';
import { daysBetween } from '$lib/engine/dates';
import { isGroup, type Schedule } from '$lib/engine/schedule';
import { dayLabel, plural } from './report';
import type { Run } from './types';

const MAX_DAYS = 366;

export const pauseHabits: Run<'pause'> = ({ actor, today, undo, report }, habits, { from, to, note }) => {
	if (to < from) throw new ActionError('invalid', 'The last day is before the first.');
	if (daysBetween(from, to) >= MAX_DAYS) throw new ActionError('invalid', `A pause can be up to ${MAX_DAYS} days long.`);
	const pauses = pausesOf(actor.accountId);
	const when = from === to ? dayLabel(from) : `${dayLabel(from)} to ${dayLabel(to)}`;
	for (const h of habits) {
		const line = { id: h.id, label: h.name };
		if (h.archived) {
			report.skip('Archived', line);
			continue;
		}
		if (h.schedule && isGroup(h.schedule as Schedule)) {
			report.skip("A group's days come from the habits inside it. Pause those instead", line);
			continue;
		}
		const covering = pauses.find((p) => (p.habitId === null || p.habitId === h.id) && p.start <= from && to <= p.end);
		if (covering) {
			report.skip(covering.habitId === null ? 'Already on vacation on these days' : 'Already paused on these days', line);
			continue;
		}
		const id = randomUUID();
		db.insert(pause).values({ id, accountId: actor.accountId, habitId: h.id, start: from, end: to, note: note?.trim() || null }).run();
		undo.pause(id);
		repaused(actor.accountId, h.id, from, to, today);
		report.change({ ...line, detail: when });
	}
	report.summary(report.count ? `Paused ${plural(report.count, 'habit')}, ${when}` : 'Nothing to pause');
};
