import { error, fail, redirect } from '@sveltejs/kit';
import {
	DEFAULT_TRIGGERS,
	defaultLevels,
	emptyCue,
	firstError,
	habitForm,
	type HabitForm
} from '$lib/forms';
import { DEFAULT_STREAK_RULE } from '$lib/engine/streak';
import {
	checkHabitForm,
	checkLinks,
	copyHabitForm,
	deleteHabit,
	getHabitForm,
	listHabits,
	saveHabit,
	setHabitArchived
} from '$lib/server/repo/habits';
import { identityFor, listIdentities } from '$lib/server/repo/identities';
import { listTagNames, listTasks, saveTask } from '$lib/server/repo/tasks';
import { listAreas } from '$lib/server/repo/areas';
import { getViews, getSettings, saveSettings } from '$lib/server/settings';
import { repaused, settle, unarchived, userToday } from '$lib/server/today';
import { ownedHabit } from '$lib/server/owned';
import { BUILTIN_TASK_TYPES, metricsFromType } from '$lib/task-types';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { metric, pause } from '$lib/server/db/schema';
import type { ScheduleForm } from '$lib/forms';
import type { Actions, PageServerLoad } from './$types';

/** Numeric Metrics per Task, so Slots can set targets for each level. */
function numericMetrics(taskIds: string[]) {
	if (!taskIds.length) return {};
	const rows = db
		.select({ id: metric.id, taskId: metric.taskId, name: metric.name, unit: metric.unit, type: metric.type })
		.from(metric)
		.where(inArray(metric.taskId, taskIds))
		.orderBy(asc(metric.sortOrder))
		.all()
		.filter((m) => m.type === 'number' || m.type === 'count' || m.type === 'duration');
	const out: Record<string, { id: string; name: string; unit: string }[]> = {};
	for (const m of rows)
		(out[m.taskId] ??= []).push({ id: m.id, name: m.name, unit: m.unit || (m.type === 'duration' ? 'min' : '') });
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
				.where(and(inArray(metric.taskId, taskIds), eq(metric.repeats, true)))
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
	cue: emptyCue(),
	streakRule: DEFAULT_STREAK_RULE,
	minimumCounts: true,
	levels: defaultLevels(),
	quickDone: false,
	remind: false,
	identityIds: [],
	ifThen: { when: '', then: '', habitId: null },
	triggers: DEFAULT_TRIGGERS,
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
	return {
		id: params.id,
		isNew,
		mode,
		copiedFrom: source?.name ?? null,
		habit: form,
		fixed,
		tasks,
		metrics: numericMetrics(tasks.map((t) => t.id)),
		/** Tasks that log something per set: only their Slots can have Target sets. */
		repeating: repeatingTasks(tasks.map((t) => t.id)),
		tags: listTagNames(accountId),
		habits: allHabits.filter((x) => x.id !== params.id).map(({ id, name, direction }) => ({ id, name, direction })),
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
		types: [...BUILTIN_TASK_TYPES, ...settings.taskTypes].map(({ key, name, description }) => ({ key, name, description }))
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
		const id = saveHabit(accountId, params.id === 'new' ? null : params.id, parsed.data, userToday(accountId, cookies.get('tz')));
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
			[...BUILTIN_TASK_TYPES, ...settings.taskTypes].find((t) => t.key === String(f.get('type'))) ?? BUILTIN_TASK_TYPES.at(-1)!;
		const areaId = String(f.get('areaId') ?? '');
		const metrics = metricsFromType(type, settings.weightUnit, randomUUID);
		const id = saveTask(accountId, null, {
			name,
			notes: '',
			restTimerEnabled: type.restTimerEnabled,
			restTimerSeconds: 90,
			tags: [],
			metrics,
			subtasks: [],
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
					.map((m) => ({ id: m.id, name: m.name, unit: m.unit || (m.type === 'duration' ? 'min' : '') }))
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
		// Count its misses up to now first: days in the archive are not counted.
		const h = ownedHabit(locals.account!.id, params.id);
		if (h?.direction === 'build' && h.schedule)
			settle(locals.account!.id, h.id, h.schedule as ScheduleForm, userToday(locals.account!.id, cookies.get('tz')));
		setHabitArchived(locals.account!.id, params.id, true);
		redirect(303, '/habits');
	},
	unarchive: ({ locals, params, cookies }) => {
		setHabitArchived(locals.account!.id, params.id, false);
		if (ownedHabit(locals.account!.id, params.id)) unarchived(params.id, userToday(locals.account!.id, cookies.get('tz')));
		return { unarchived: true };
	},
	delete: ({ locals, params }) => {
		deleteHabit(locals.account!.id, params.id);
		const s = getSettings(locals.account!.id);
		if (s.pinned.includes(params.id)) saveSettings(locals.account!.id, { pinned: s.pinned.filter((x) => x !== params.id) });
		redirect(303, '/habits');
	}
};
