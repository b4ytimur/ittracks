import { error, fail, redirect } from '@sveltejs/kit';
import {
	defaultTriggers,
	defaultLevels,
	emptyCue,
	firstError,
	habitForm,
	type HabitForm,
	rowWords
} from '$lib/forms';
import { DEFAULT_STREAK_RULE } from '$lib/engine/streak';
import {
	checkHabitEdit,
	checkHabitForm,
	checkLinks,
	copyHabitForm,
	getHabitForm,
	listHabits,
	saveHabit
} from '$lib/server/repo/habits';
import { feelingsUsed, habitLogged, PastEditError } from '$lib/server/history';
import { identityFor, listIdentities } from '$lib/server/repo/identities';
import { listTagNames, listTasks, saveTask } from '$lib/server/repo/tasks';
import { listAreas } from '$lib/server/repo/areas';
import { getViews, getSettings, getTaskTypes, getUnits, saveSettings } from '$lib/server/settings';
import { repaused, userToday } from '$lib/server/today';
import { ownedHabit } from '$lib/server/owned';
import { trash } from '$lib/server/trash';
import { archiveHabit, unarchiveHabit } from '$lib/server/habit-actions';
import { defaultStep, metricsFromType, PLAIN_TASK_TYPES } from '$lib/task-types';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { metric, occurrence, pause, slot, taskPart, variant } from '$lib/server/db/schema';
import { isGroup, variantsIn, type Schedule } from '$lib/engine/schedule';
import { descendants } from '$lib/engine/tree';
import type { Actions, PageServerLoad } from './$types';

/** Numeric Metrics per Task, so Slots can set targets for each level. */
function numericMetrics(accountId: string, taskIds: string[]) {
	const units = getUnits(accountId);
	if (!taskIds.length) return {};
	const rows = db
		.select({ id: metric.id, taskId: metric.taskId, name: metric.name, unit: metric.unit, type: metric.type, step: metric.step })
		.from(metric)
		.where(and(inArray(metric.taskId, taskIds), eq(metric.archived, false)))
		.orderBy(asc(metric.sortOrder))
		.all()
		.filter((m) => m.type === 'number' || m.type === 'count' || m.type === 'duration');
	const out: Record<string, { id: string; name: string; unit: string; step: number }[]> = {};
	for (const m of rows)
		(out[m.taskId] ??= []).push({ id: m.id, name: m.name, unit: m.unit || (m.type === 'duration' ? 'min' : ''), step: m.step ?? defaultStep(m.type, m.unit, units) });
	return out;
}

/** Tasks with at least one field logged per set. */
function repeatingTasks(taskIds: string[]): string[] {
	if (!taskIds.length) return [];
	return [
		...new Set(
			db
				.select({ taskId: metric.taskId })
				.from(metric)
				.where(and(inArray(metric.taskId, taskIds), eq(metric.repeats, true), eq(metric.archived, false)))
				.all()
				.map((m) => m.taskId)
		)
	];
}

const blank = (today: string): HabitForm => ({
	name: '',
	direction: 'build',
	notes: '',
	startDate: today,
	variants: [],
	schedule: null,
	parentId: null,
	cue: emptyCue(),
	streakRule: DEFAULT_STREAK_RULE,
	minimumCounts: true,
	levels: defaultLevels(),
	quickDone: false,
	remind: false,
	identityIds: [],
	ifThen: { when: '', then: '', habitId: null },
	triggers: defaultTriggers(),
	reframe: '',
	bundle: { reward: '', strict: false },
	prep: [],
	reward: { celebrate: false, message: '', jar: null },
	cost: null,
	limit: null,
	progression: null,
	areaId: null,
	unlogged: 'missed'
});

export const load: PageServerLoad = ({ locals, params, url, cookies }) => {
	const accountId = locals.account!.id;
	const isNew = params.id === 'new';
	const settings = getSettings(accountId);
	const from = url.searchParams.get('from');
	const source = isNew && from ? getHabitForm(accountId, from) : null;
	const loaded = isNew ? (source ? copyHabitForm(source) : blank(userToday(accountId, cookies.get('tz')))) : getHabitForm(accountId, params.id);
	if (!loaded) error(404, 'Habit not found');
	// Old data may break a conflict rule; fix it with each rule's winner and say what changed.
	const { form, fixed } = checkHabitForm(loaded, { resolve: true });
	if (isNew) {
		form.startDate = userToday(accountId, cookies.get('tz'));
		const area = url.searchParams.get('area');
		if (area && !source) form.areaId = area;
	}
	// New habits first ask how to start, unless the user turned that off or already chose.
	const asked = url.searchParams.get('mode');
	const mode: 'choose' | 'guided' | 'full' =
		!isNew || source ? 'full' : asked === 'guided' || asked === 'full' ? asked : settings.guidedSetup ? 'choose' : 'full';
	const tasks = listTasks(accountId).map(({ id, name }) => ({ id, name }));
	const allHabits = listHabits(accountId);
	// Habits this one can sit in: groups, and routines (a habit with a schedule and no Tasks of
	// its own). Not itself, nor one inside it. Its current parent stays listed even when
	// archived, so the form shows where it is.
	const withArchived = listHabits(accountId, { archived: true });
	const below = isNew ? new Set<string>() : descendants(withArchived, params.id);
	const withSlots = new Set(db.select({ habitId: variant.habitId }).from(slot).innerJoin(variant, eq(slot.variantId, variant.id)).all().map((r) => r.habitId));
	const groups = withArchived
		.filter(
			(x) =>
				x.direction === 'build' &&
				x.schedule &&
				(isGroup(x.schedule) || !withSlots.has(x.id)) &&
				x.id !== params.id &&
				!below.has(x.id) &&
				(!x.archived || x.id === form.parentId)
		)
		.map(({ id, name, archived, schedule }) => ({
			id,
			name,
			archived,
			/** A routine has days of its own, so a habit inside it can follow them. */
			routine: !isGroup(schedule),
			/** Its days bring up more than one of its Variants, so a habit inside with its own rotation can drift from it. */
			rotates: !isGroup(schedule) && variantsIn(schedule as Schedule).length > 1,
			variants: isGroup(schedule) ? [] : db.select({ id: variant.id, name: variant.name }).from(variant).where(eq(variant.habitId, id)).orderBy(asc(variant.sortOrder)).all()
		}));
	return {
		id: params.id,
		isNew,
		mode,
		copiedFrom: source?.name ?? null,
		habit: form,
		fixed,
		tasks,
		metrics: numericMetrics(accountId, tasks.map((t) => t.id)),
		/** Tasks that log something per set: only their Slots can have Target sets. */
		repeating: repeatingTasks(tasks.map((t) => t.id)),
		/** Tasks with parts inside: their Slots can have rounds (when they log nothing per set). */
		withParts: [
			...new Set(
				tasks.length
					? db.select({ taskId: taskPart.taskId }).from(taskPart).where(and(inArray(taskPart.taskId, tasks.map((t) => t.id)), eq(taskPart.archived, false))).all().map((r) => r.taskId)
					: []
			)
		],
		tags: listTagNames(accountId),
		habits: allHabits.filter((x) => x.id !== params.id).map(({ id, name, direction }) => ({ id, name, direction })),
		groups,
		/** For a group or routine: the habits inside it. */
		inside: isNew ? [] : withArchived.filter((x) => x.parentId === params.id).map(({ id, name, archived }) => ({ id, name, archived })),
		/** A habit with its own logs can't become a group: a group's days come from the habits inside it. */
		ownLogs: !isNew && !isGroup(loaded.schedule) && habitLogged(params.id),
		identities: listIdentities(accountId),
		areas: listAreas(accountId),
		ranges: settings.ranges,
		showAllSections: settings.showAllSections,
		hidden: getViews(accountId).hidden,
		pinned: !isNew && settings.pinned.includes(params.id),
		archived: !isNew && !!ownedHabit(accountId, params.id)?.archived,
		pauses: isNew
			? []
			: db
					.select({ id: pause.id, start: pause.start, end: pause.end, note: pause.note })
					.from(pause)
					.where(and(eq(pause.accountId, accountId), eq(pause.habitId, params.id)))
					.orderBy(asc(pause.start))
					.all(),
		today: userToday(accountId, cookies.get('tz')),
		/** Something is logged: build or break is fixed (history policies, src/lib/rules/history.ts). */
		directionLocked: !isNew && habitLogged(params.id),
		/** Feelings past slips were logged with: removing one archives it. */
		usedFeelings: isNew ? [] : [...feelingsUsed(params.id)],
		/** Something was logged already: a rotation's plan has days to keep when the start moves. */
		hasLogs:
			!isNew &&
			!!db
				.select({ id: occurrence.id })
				.from(occurrence)
				.where(and(eq(occurrence.habitId, params.id), inArray(occurrence.status, ['done', 'skipped'])))
				.get(),
		types: getTaskTypes(accountId).map(({ key, name, description }) => ({ key, name, description }))
	};
};

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export const actions: Actions = {
	save: async ({ request, locals, params, cookies }) => {
		let json: unknown;
		try {
			json = JSON.parse(String((await request.formData()).get('payload')));
		} catch {
			return fail(400, { error: 'Could not read the form.' });
		}
		const parsed = habitForm.safeParse(json);
		if (!parsed.success) return fail(400, { error: firstError(parsed.error) });
		const accountId = locals.account!.id;
		const conflict = checkHabitForm(parsed.data).errors[0];
		if (conflict) return fail(400, { error: conflict.reason });
		const linkError = checkLinks(accountId, params.id === 'new' ? null : params.id, parsed.data);
		if (linkError) return fail(400, { error: linkError });
		// A schedule edit applies from today on unless the editor says past days too.
		const applies = (json as { scheduleApplies?: unknown }).scheduleApplies === 'past' ? 'past' : 'today';
		// History policies: switching build and break once logged is refused.
		const refused = params.id === 'new' ? null : checkHabitEdit(accountId, params.id, parsed.data);
		if (refused) return fail(400, { error: refused });
		let id: string | null;
		try {
			id = saveHabit(accountId, params.id === 'new' ? null : params.id, parsed.data, userToday(accountId, cookies.get('tz')), { scheduleApplies: applies });
		} catch (e) {
			if (e instanceof PastEditError) return fail(400, { error: e.message });
			throw e;
		}
		if (!id) error(404, 'Habit not found');
		// Home screen shortcut, kept in Settings so the manifest can list it.
		const pin = (json as { pinned?: unknown }).pinned;
		if (typeof pin === 'boolean') {
			const s = getSettings(accountId);
			const rest = s.pinned.filter((x) => x !== id);
			saveSettings(accountId, { pinned: pin ? [...rest, id].slice(-4) : rest });
		}
		redirect(303, params.id === 'new' ? `/habits?added=${encodeURIComponent(parsed.data.name)}` : '/habits');
	},
	/** Make a Task from inside the editor, from a Task type. Returns it so a Slot can use it. */
	quickTask: async ({ request, locals }) => {
		const f = await request.formData();
		const name = String(f.get('name') ?? '').trim().slice(0, 120);
		if (!name) return fail(400, { taskError: 'Name the Task.' });
		const accountId = locals.account!.id;
		const settings = getSettings(accountId);
		const type =
			getTaskTypes(accountId).find((t) => t.key === String(f.get('type'))) ?? PLAIN_TASK_TYPES.at(-1)!;
		const areaId = String(f.get('areaId') ?? '');
		const units = getUnits(accountId);
		const metrics = metricsFromType(type, units, randomUUID);
		const id = saveTask(accountId, null, {
			name,
			notes: '',
			restTimerEnabled: type.restTimerEnabled,
			restTimerSeconds: 90,
			...rowWords(),
			...type.words,
			tags: [],
			metrics,
			parts: [],
			areaId: listAreas(accountId).some((a) => a.id === areaId) ? areaId : null,
			collectionIds: []
		});
		return {
			newTask: {
				id,
				name,
				repeats: metrics.some((m) => m.repeats),
				metrics: metrics
					.filter((m) => m.type === 'number' || m.type === 'count' || m.type === 'duration')
					.map((m) => ({ id: m.id, name: m.name, unit: m.unit || (m.type === 'duration' ? 'min' : ''), step: m.step ?? defaultStep(m.type, m.unit, units) }))
			}
		};
	},
	/** Identity created from inside the editor; the page adds it to the Habit. */
	identity: async ({ request, locals }) => {
		const statement = String((await request.formData()).get('statement') ?? '').trim().slice(0, 120);
		if (!statement) return fail(400, { error: 'Write the identity as a sentence.' });
		return { identityId: identityFor(locals.account!.id, statement), statement };
	},
	pause: async ({ request, locals, params, cookies }) => {
		const f = await request.formData();
		const h = ownedHabit(locals.account!.id, params.id);
		if (!h) error(404);
		const start = String(f.get('start') ?? '');
		const end = String(f.get('end') ?? '');
		if (!isDate(start) || !isDate(end) || end < start) return fail(400, { pauseError: 'Pick a start and an end date.' });
		db.insert(pause)
			.values({ id: randomUUID(), accountId: locals.account!.id, habitId: h.id, start, end, note: String(f.get('note') ?? '').slice(0, 120) || null })
			.run();
		// A pause over past days takes back the misses counted for them.
		repaused(locals.account!.id, h.id, start, end, userToday(locals.account!.id, cookies.get('tz')));
		return { paused: true };
	},
	unpause: async ({ request, locals, cookies }) => {
		const id = String((await request.formData()).get('id') ?? '');
		const where = and(eq(pause.id, id), eq(pause.accountId, locals.account!.id));
		const p = db.select().from(pause).where(where).get();
		if (!p) return;
		db.delete(pause).where(where).run();
		repaused(locals.account!.id, p.habitId, p.start, p.end, userToday(locals.account!.id, cookies.get('tz')));
	},
	archive: ({ locals, params, cookies }) => {
		archiveHabit(locals.account!.id, params.id, userToday(locals.account!.id, cookies.get('tz')));
		redirect(303, '/habits');
	},
	unarchive: ({ locals, params, cookies }) => {
		unarchiveHabit(locals.account!.id, params.id, userToday(locals.account!.id, cookies.get('tz')));
		return { unarchived: true };
	},
	delete: ({ locals, params, cookies }) => {
		const deleted = trash(locals.account!.id, 'habit', params.id, userToday(locals.account!.id, cookies.get('tz')));
		return deleted ? { deleted } : fail(404, { error: 'No such habit' });
	}
};
