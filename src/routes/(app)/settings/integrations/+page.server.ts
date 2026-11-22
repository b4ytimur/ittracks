import { fail } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { metric, slot, variant } from '$lib/server/db/schema';
import { listHabits } from '$lib/server/repo/habits';
import { ALL_SCOPES, SCOPES, type Scope } from '$lib/server/core/actor';
import { createKey, listKeys, revokeKey } from '$lib/server/core/tokens';
import type { Actions, PageServerLoad } from './$types';

/** The number fields each habit can take a value for, so the link builder can offer them. */
function numberFields(habitIds: string[]): Record<string, string[]> {
	if (!habitIds.length) return {};
	const rows = db
		.select({ habitId: variant.habitId, name: metric.name })
		.from(slot)
		.innerJoin(variant, eq(slot.variantId, variant.id))
		.innerJoin(metric, eq(metric.taskId, slot.taskId))
		.where(and(inArray(variant.habitId, habitIds), isNotNull(slot.taskId), inArray(metric.type, ['number', 'count', 'duration'])))
		.orderBy(asc(slot.sortOrder), asc(metric.sortOrder))
		.all();
	const out: Record<string, string[]> = {};
	for (const r of rows) if (!(out[r.habitId] ??= []).includes(r.name)) out[r.habitId].push(r.name);
	return out;
}

export const load: PageServerLoad = ({ locals, url }) => {
	const accountId = locals.account!.id;
	const habits = listHabits(accountId).map((h) => ({ id: h.id, name: h.name, direction: h.direction }));
	return {
		keys: listKeys(accountId),
		habits,
		fields: numberFields(habits.map((h) => h.id)),
		scopes: SCOPES,
		origin: url.origin
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const f = await request.formData();
		const name = String(f.get('name') ?? '');
		const scopes = f.getAll('scope').map(String).filter((s): s is Scope => (ALL_SCOPES as string[]).includes(s));
		const habitIds = f.get('limit') === 'some' ? f.getAll('habit').map(String) : null;
		const made = createKey(locals.account!.id, { name, scopes, habitIds });
		if ('error' in made) return fail(400, { error: made.error, name, scopes });
		return { created: { id: made.id, name: name.trim(), secret: made.secret, scopes } };
	},
	revoke: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!revokeKey(locals.account!.id, id)) return fail(404, { error: 'That key is already gone.' });
		return { revoked: true };
	}
};
