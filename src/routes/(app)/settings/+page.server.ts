// Settings: one page of lines. Plain settings are saved one at a time through /api/settings, views
// through /api/views and Stats through /api/stats; what is an act rather than a setting is here.
import { fail } from '@sveltejs/kit';
import { hash, verify } from '@node-rs/argon2';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { checkViews } from '$lib/rules/views';
import { db } from '$lib/server/db';
import { account, habit, metric, slot, tag, task, taskTag, variant } from '$lib/server/db/schema';
import { ActionError, ALL_SCOPES, appActor, SCOPES, type Scope } from '$lib/server/core/actor';
import { importReplace, keepTimeZone, readExport } from '$lib/server/core/export';
import { createKey, listKeys, revokeKey } from '$lib/server/core/tokens';
import { publicKey, sendToAccount, subscriptionCount } from '$lib/server/push';
import { listHabits } from '$lib/server/repo/habits';
import { usedRanges } from '$lib/server/repo/ranges';
import { addTag, moveTag, removeTag, renameTag } from '$lib/server/repo/tags';
import { addPause, pausesOf, removePause } from '$lib/server/pauses';
import { listVacations } from '$lib/server/repo/vacations';
import { getGroupings, getKinds, getPacks, getSettings, getViews } from '$lib/server/settings';
import { getStats, seedFields } from '$lib/server/stats';
import { suggestions } from '$lib/stats/seed';
import { userToday } from '$lib/server/today';
import { ownTypes } from '$lib/server/settings-patch';
import { PLAIN_TASK_TYPES } from '$lib/task-types';
import { unitWord } from '$lib/units';
import type { Actions, PageServerLoad } from './$types';

/** The number fields each habit can take a value for, so the link builder can offer them. */
function numberFields(habitIds: string[]): Record<string, string[]> {
	if (!habitIds.length) return {};
	const rows = db
		.select({ habitId: variant.habitId, name: metric.name })
		.from(slot)
		.innerJoin(variant, eq(slot.variantId, variant.id))
		.innerJoin(metric, eq(metric.taskId, slot.taskId))
		.where(and(inArray(variant.habitId, habitIds), eq(variant.archived, false), isNotNull(slot.taskId), inArray(metric.type, ['number', 'count', 'duration'])))
		.orderBy(asc(slot.sortOrder), asc(metric.sortOrder))
		.all();
	const out: Record<string, string[]> = {};
	for (const r of rows) if (!(out[r.habitId] ??= []).includes(r.name)) out[r.habitId].push(r.name);
	return out;
}

/** The fields a formula can use, by name, with the Tasks that have them. */
function formulaFields(accountId: string): { name: string; tasks: string[] }[] {
	const rows = db
		.select({ name: metric.name, task: task.name })
		.from(metric)
		.innerJoin(task, eq(metric.taskId, task.id))
		.where(and(eq(task.accountId, accountId), inArray(metric.type, ['number', 'count', 'duration', 'checkbox']), eq(task.archived, false)))
		.all();
	const fields = new Map<string, string[]>();
	for (const r of rows) fields.set(r.name, [...new Set([...(fields.get(r.name) ?? []), r.task])]);
	return [...fields.entries()].map(([name, tasks]) => ({ name, tasks })).sort((a, b) => a.name.localeCompare(b.name));
}

/** How many fields are written in each unit, by its word. */
function usedUnits(accountId: string): Record<string, number> {
	const out: Record<string, number> = {};
	for (const r of db.select({ unit: metric.unit }).from(metric).innerJoin(task, eq(metric.taskId, task.id)).where(and(eq(task.accountId, accountId), isNotNull(metric.unit))).all()) {
		const w = unitWord(r.unit);
		if (w) out[w] = (out[w] ?? 0) + 1;
	}
	return out;
}

/** Every tag, the grouping it is in, and how many Tasks have it at each level. */
function tagsWithUses(accountId: string) {
	const uses = db
		.select({ tagId: taskTag.tagId, level: taskTag.level })
		.from(taskTag)
		.innerJoin(tag, eq(taskTag.tagId, tag.id))
		.where(eq(tag.accountId, accountId))
		.all();
	return db
		.select({ id: tag.id, name: tag.name, grouping: tag.grouping })
		.from(tag)
		.where(eq(tag.accountId, accountId))
		.orderBy(asc(tag.name))
		.all()
		.map((t) => ({ ...t, levels: uses.filter((x) => x.tagId === t.id).map((x) => x.level) }));
}

export const load: PageServerLoad = ({ locals, cookies, url }) => {
	const accountId = locals.account!.id;
	const { dayStart, ranges, pastDays, nudgeYesterday, dayNote, guidedSetup } = getSettings(accountId);
	const views = getViews(accountId);
	const s = getStats(accountId);
	const habits = listHabits(accountId).map((h) => ({ id: h.id, name: h.name, direction: h.direction }));
	return {
		username: locals.account!.username,
		today: userToday(accountId, cookies.get('tz')),
		settings: { dayStart: dayStart ?? null, ranges, pastDays, nudgeYesterday, dayNote, guidedSetup, units: getKinds(accountId), groupings: getGroupings(accountId), taskTypes: ownTypes(accountId) },
		packs: getPacks(accountId),
		plainTypes: PLAIN_TASK_TYPES,
		tags: tagsWithUses(accountId),
		usedUnits: usedUnits(accountId),
		usedRanges: usedRanges(accountId),
		vacations: listVacations(accountId),
		views,
		viewIssues: checkViews(views, { ranges: ranges.length }),
		stats: { measures: s.measures, fields: formulaFields(accountId), suggestions: suggestions(seedFields(accountId)) },
		vapidKey: publicKey(),
		devices: subscriptionCount(accountId),
		/** Every habit that could remind you, with whether it does. */
		reminders: db
			.select({ id: habit.id, name: habit.name, cue: habit.cue, remind: habit.remind, reminder: habit.reminder })
			.from(habit)
			.where(and(eq(habit.accountId, accountId), eq(habit.archived, false), isNull(habit.deleteAfter)))
			.orderBy(asc(habit.name))
			.all()
			.flatMap((h) => {
				const when = h.reminder?.time ?? h.cue?.time ?? h.cue?.range;
				return when ? [{ id: h.id, name: h.name, when, remind: h.remind }] : [];
			}),
		habits,
		habitFields: numberFields(habits.map((h) => h.id)),
		keys: listKeys(accountId),
		scopes: SCOPES,
		origin: url.origin
	};
};


/** Plenty for years of logs; the server's BODY_SIZE_LIMIT has to allow it too. */
const MAX_IMPORT = 50 * 1024 * 1024;

async function fileFrom(request: Request): Promise<{ raw: unknown; form: FormData } | { error: string }> {
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return { error: 'The file is too big for this server. Raise BODY_SIZE_LIMIT (see the README) and try again.' };
	}
	const file = form.get('file');
	if (!(file instanceof File) || !file.size) return { error: 'Pick a backup file first.' };
	if (file.size > MAX_IMPORT) return { error: 'That file is bigger than 50 MB, so it is not an ittracks backup.' };
	try {
		return { raw: JSON.parse(await file.text()), form };
	} catch {
		return { error: 'This is not an ittracks backup (it is not JSON).' };
	}
}

export const actions: Actions = {
	/** A vacation pauses every habit for a date range. */
	vacation: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const r = addPause(locals.account!.id, null, String(f.get('start') ?? ''), String(f.get('end') ?? ''), String(f.get('note') ?? ''), userToday(locals.account!.id, cookies.get('tz')));
		return 'error' in r ? fail(400, r) : r;
	},
	unvacation: async ({ request, locals, cookies }) => {
		const id = String((await request.formData()).get('id') ?? '');
		const p = pausesOf(locals.account!.id, null).find((x) => x.id === id);
		if (!p) return fail(404, { error: 'That vacation is already gone.' });
		removePause(locals.account!.id, id, userToday(locals.account!.id, cookies.get('tz')));
	},
	/** A member for a grouping: a tag no Task has yet. */
	addTag: async ({ request, locals }) => {
		const f = await request.formData();
		const r = addTag(locals.account!.id, String(f.get('name') ?? ''), String(f.get('grouping') ?? ''));
		return 'error' in r ? fail(r.status, { error: r.error }) : { id: r.id };
	},
	renameTag: async ({ request, locals }) => {
		const f = await request.formData();
		const r = renameTag(locals.account!.id, String(f.get('id') ?? ''), String(f.get('name') ?? ''));
		return 'error' in r ? fail(400, r) : r;
	},
	/** Put a member in another grouping. Its Tasks keep their level. */
	moveTag: async ({ request, locals }) => {
		const f = await request.formData();
		const r = moveTag(locals.account!.id, String(f.get('id') ?? ''), String(f.get('grouping') ?? '') || null);
		return 'error' in r ? fail(r.status, { error: r.error }) : { was: r.was ?? '' };
	},
	/** Only one no Task has. */
	removeTag: async ({ request, locals }) => {
		const r = removeTag(locals.account!.id, String((await request.formData()).get('id') ?? ''));
		if ('error' in r) return fail(r.status, { error: r.error });
	},
	testReminder: async ({ locals }) => {
		const sent = await sendToAccount(locals.account!.id, { title: 'ittracks', body: 'Reminders work on this device.', url: '/settings#reminders' });
		return sent ? { sent } : fail(400, { error: 'No device is set up for reminders yet.' });
	},
	/** Say what a file holds, without changing anything. */
	preview: async ({ request }) => {
		const got = await fileFrom(request);
		if ('error' in got) return fail(400, got);
		const r = readExport(got.raw);
		if ('error' in r) return fail(400, { error: r.error });
		return { preview: r.preview };
	},
	import: async ({ request, locals, cookies }) => {
		const got = await fileFrom(request);
		if ('error' in got) return fail(400, { error: got.error });
		if (got.form.get('confirm') !== 'yes') return fail(400, { error: 'This replaces your data, and that was not confirmed.' });
		try {
			const r = importReplace(appActor(locals.account!.id, cookies.get('tz')), got.raw);
			keepTimeZone(locals.account!.id, cookies.get('tz'));
			return { imported: r.counts, renumbered: r.renumbered };
		} catch (e) {
			if (e instanceof ActionError) return fail(400, { error: e.message });
			throw e;
		}
	},
	createKey: async ({ request, locals }) => {
		const f = await request.formData();
		const scopes = f.getAll('scope').map(String).filter((s): s is Scope => (ALL_SCOPES as string[]).includes(s));
		const name = String(f.get('name') ?? '');
		const made = createKey(locals.account!.id, { name, scopes, habitIds: f.get('limit') === 'some' ? f.getAll('habit').map(String) : null });
		if ('error' in made) return fail(400, { error: made.error });
		return { created: { name: name.trim(), secret: made.secret } };
	},
	revokeKey: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!revokeKey(locals.account!.id, id)) return fail(404, { error: 'That key is already gone.' });
		return { revoked: true };
	},
	password: async ({ request, locals }) => {
		const f = await request.formData();
		const current = String(f.get('current') ?? '');
		const next = String(f.get('next') ?? '');
		const row = db.select().from(account).where(eq(account.id, locals.account!.id)).get();
		if (!row || !(await verify(row.passwordHash, current))) return fail(400, { error: 'Your current password is wrong.' });
		if (next.length < 8) return fail(400, { error: 'Use at least 8 characters.' });
		db.update(account).set({ passwordHash: await hash(next) }).where(eq(account.id, row.id)).run();
		return { changed: true };
	}
};
