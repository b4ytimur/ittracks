import { listHabits } from '$lib/server/repo/habits';
import { listAreas } from '$lib/server/repo/areas';
import { getViews } from '$lib/server/settings';
import { identitiesByHabit } from '$lib/server/repo/identities';
import { habitStats } from '$lib/engine/stats';
import { db } from '$lib/server/db';
import { habit, occurrence, slot, variant } from '$lib/server/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { userToday } from '$lib/server/today';
import { initialState, templateById } from '$lib/views';
import { fail } from '@sveltejs/kit';
import { archiveHabit, moveHabit, renameHabit, unarchiveHabit } from '$lib/server/habit-actions';
import { isGroup } from '$lib/engine/schedule';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url, cookies }) => {
	const accountId = locals.account!.id;
	const today = userToday(accountId, cookies.get('tz'));
	const idents = identitiesByHabit(accountId);
	// Every Occurrence of the user's habits in one query, for consistency and "last done".
	const marks = new Map<string, { date: string; status: string }[]>();
	for (const m of db
		.select({ habitId: occurrence.habitId, date: occurrence.date, status: occurrence.status })
		.from(occurrence)
		.innerJoin(habit, eq(occurrence.habitId, habit.id))
		.where(eq(habit.accountId, accountId))
		.all())
		marks.set(m.habitId, [...(marks.get(m.habitId) ?? []), m]);
	// Habits with Tasks of their own can't hold habits (yet): what edit mode may drop inside.
	const slotted = new Set(
		db
			.selectDistinct({ id: variant.habitId })
			.from(slot)
			.innerJoin(variant, eq(slot.variantId, variant.id))
			.innerJoin(habit, eq(variant.habitId, habit.id))
			.where(and(eq(habit.accountId, accountId), eq(variant.archived, false)))
			.all()
			.map((r) => r.id)
	);
	// Variant names, so phases and habits that follow a routine read with them.
	const variantsOf = new Map<string, { id: string; name: string }[]>();
	for (const v of db
		.select({ id: variant.id, name: variant.name, habitId: variant.habitId })
		.from(variant)
		.innerJoin(habit, eq(variant.habitId, habit.id))
		.where(and(eq(habit.accountId, accountId), eq(variant.archived, false)))
		.orderBy(asc(variant.sortOrder))
		.all())
		variantsOf.set(v.habitId, [...(variantsOf.get(v.habitId) ?? []), { id: v.id, name: v.name }]);
	const views = getViews(accountId);
	// The old ?archived link still works: it turns the archived filter on.
	const initial = initialState(views, 'habits');
	if (url.searchParams.has('archived')) initial.archived = true;
	return {
		habits: listHabits(accountId, { archived: true }).map((h) => {
			const st = habitStats(marks.get(h.id) ?? [], today);
			return {
				...h,
				createdAt: h.createdAt.getTime(),
				identities: idents.get(h.id) ?? [],
				variants: variantsOf.get(h.id) ?? [],
				/** Can hold habits: a group, or a build habit with a schedule and no Tasks of its own (a routine). */
				holds: h.direction === 'build' && !!h.schedule && (isGroup(h.schedule) || !slotted.has(h.id)),
				consistency: h.direction === 'break' ? null : st.consistency,
				consistencyDays: st.days,
				lastDone: st.lastDone
			};
		}),
		areas: listAreas(accountId),
		views,
		initial,
		/** For the bulk bar's date inputs. */
		today,
		added: url.searchParams.get('added'),
		/** After an import: how many Tasks were made, and how many came from your Library. */
		created: Number(url.searchParams.get('created')) || 0,
		reused: Number(url.searchParams.get('reused')) || 0,
		inside: Number(url.searchParams.get('inside')) || 0,
		suggestView: (() => {
			const t = templateById(url.searchParams.get('view') ?? '');
			return t && t.id !== views.template ? { id: t.id, name: t.name, summary: t.summary } : null;
		})()
	};
};

/** Changes the list makes in place while editing. The order is a view setting (/api/views). */
export const actions: Actions = {
	rename: async ({ request, locals }) => {
		const f = await request.formData();
		const r = renameHabit(locals.account!.id, String(f.get('id') ?? ''), String(f.get('name') ?? ''));
		if ('error' in r) return fail(400, { error: r.error });
		return { renamed: r.name };
	},
	archive: async ({ request, locals, cookies }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!archiveHabit(locals.account!.id, id, userToday(locals.account!.id, cookies.get('tz')))) return fail(404, { error: 'No such habit' });
		return { archived: id };
	},
	/** Edit mode's nest and outdent drops: `parent` empty means the top level. */
	move: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const accountId = locals.account!.id;
		const applies = f.get('applies') === 'past' ? 'past' : 'today';
		const r = moveHabit(accountId, String(f.get('id') ?? ''), String(f.get('parent') ?? '') || null, userToday(accountId, cookies.get('tz')), applies);
		if ('error' in r) return fail(400, { error: r.error });
		return { moved: r.parentId, undo: 'undo' in r ? (r.undo ?? null) : null, groupStart: 'groupStart' in r ? (r.groupStart ?? null) : null };
	},
	unarchive: async ({ request, locals, cookies }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!unarchiveHabit(locals.account!.id, id, userToday(locals.account!.id, cookies.get('tz')))) return fail(404, { error: 'No such habit' });
		return { unarchived: id };
	}
};
