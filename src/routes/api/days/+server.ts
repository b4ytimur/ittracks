// Day counts for the days block when it steps outside what its page loaded (src/lib/server/days.ts).
import { error, json } from '@sveltejs/kit';
import { isRealDate } from '$lib/engine/backfill';
import { daysBetween } from '$lib/engine/dates';
import { dayCounts, dayHabits } from '$lib/server/days';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url, locals }) => {
	if (!locals.account) error(401);
	const from = url.searchParams.get('from') ?? '', to = url.searchParams.get('to') ?? '', habit = url.searchParams.get('habit');
	if (!isRealDate(from) || !isRealDate(to) || from > to || daysBetween(from, to) > 400) error(400, 'from and to: real dates, at most 400 days apart');
	if (habit && !dayHabits(locals.account.id).some((h) => h.id === habit)) error(404);
	return json({ counts: dayCounts(locals.account.id, from, to, habit) });
};
