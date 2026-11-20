import { and, desc, eq, gte, inArray, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { entry, habit, occurrence, slip, variant } from '$lib/server/db/schema';
import { userToday } from '$lib/server/today';
import { addDays } from '$lib/engine/dates';
import type { PageServerLoad } from './$types';

const DAYS = 90;

export const load: PageServerLoad = ({ locals, cookies, url }) => {
	const accountId = locals.account!.id;
	const days = Math.min(Number(url.searchParams.get('days')) || DAYS, 3650);
	const from = addDays(userToday(accountId, cookies.get('tz')), -days);

	const occ = db
		.select({
			id: occurrence.id,
			date: occurrence.date,
			status: occurrence.status,
			habitId: habit.id,
			habit: habit.name,
			variant: variant.name
		})
		.from(occurrence)
		.innerJoin(habit, eq(occurrence.habitId, habit.id))
		.leftJoin(variant, eq(occurrence.variantId, variant.id))
		.where(and(eq(habit.accountId, accountId), ne(occurrence.status, 'due'), gte(occurrence.date, from)))
		.orderBy(desc(occurrence.date))
		.all();
	const counts = occ.length
		? db
				.select({ occurrenceId: entry.occurrenceId })
				.from(entry)
				.where(inArray(entry.occurrenceId, occ.map((o) => o.id)))
				.all()
		: [];
	const slips = db
		.select({ date: slip.date, count: slip.count, habit: habit.name })
		.from(slip)
		.innerJoin(habit, eq(slip.habitId, habit.id))
		.where(and(eq(habit.accountId, accountId), gte(slip.date, from)))
		.orderBy(desc(slip.date))
		.all();

	// Only name the Variant when a habit has more than one.
	const multi = new Set(
		db
			.select({ habitId: variant.habitId })
			.from(variant)
			.innerJoin(habit, eq(variant.habitId, habit.id))
			.where(eq(habit.accountId, accountId))
			.all()
			.map((v) => v.habitId)
			.filter((id, i, all) => all.indexOf(id) !== i)
	);
	for (const o of occ) if (!multi.has(o.habitId)) o.variant = null;

	// One row per day, newest first.
	const byDay = new Map<string, { occurrences: typeof occ; slips: typeof slips }>();
	const day = (d: string) => byDay.get(d) ?? byDay.set(d, { occurrences: [], slips: [] }).get(d)!;
	occ.forEach((o) => day(o.date).occurrences.push(o));
	slips.forEach((s) => day(s.date).slips.push(s));

	return {
		days,
		entryCounts: Object.fromEntries(
			occ.map((o) => [o.id, counts.filter((c) => c.occurrenceId === o.id).length])
		),
		history: [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))
	};
};
