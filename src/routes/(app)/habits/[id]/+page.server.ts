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
import { checkLinks, deleteHabit, getHabitForm, listHabits, saveHabit } from '$lib/server/repo/habits';
import { identityFor, listIdentities } from '$lib/server/repo/identities';
import { listTagNames, listTasks } from '$lib/server/repo/tasks';
import { asc, inArray } from 'drizzle-orm';
import { todayIn } from '$lib/server/today';
import { db } from '$lib/server/db';
import { metric } from '$lib/server/db/schema';
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
	progression: null
});

export const load: PageServerLoad = ({ locals, params, cookies }) => {
	const accountId = locals.account!.id;
	const isNew = params.id === 'new';
	const form = isNew ? blank(todayIn(cookies.get('tz'))) : getHabitForm(accountId, params.id);
	if (!form) error(404, 'Habit not found');
	const tasks = listTasks(accountId).map(({ id, name }) => ({ id, name }));
	return {
		id: params.id,
		isNew,
		habit: form,
		tasks,
		metrics: numericMetrics(tasks.map((t) => t.id)),
		tags: listTagNames(accountId),
		habits: listHabits(accountId)
			.filter((x) => x.id !== params.id)
			.map(({ id, name, direction }) => ({ id, name, direction })),
		identities: listIdentities(accountId)
	};
};

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
		const linkError = checkLinks(locals.account!.id, params.id === 'new' ? null : params.id, parsed.data);
		if (linkError) return fail(400, { error: linkError });
		const id = saveHabit(
			locals.account!.id,
			params.id === 'new' ? null : params.id,
			parsed.data,
			todayIn(cookies.get('tz'))
		);
		if (!id) error(404, 'Habit not found');
		redirect(303, '/habits');
	},
	/** Create an Identity from inside the editor; the page adds it to the Habit. */
	identity: async ({ request, locals }) => {
		const statement = String((await request.formData()).get('statement') ?? '').trim().slice(0, 120);
		if (!statement) return fail(400, { error: 'Write the identity as a sentence.' });
		return { identityId: identityFor(locals.account!.id, statement), statement };
	},
	delete: ({ locals, params }) => {
		deleteHabit(locals.account!.id, params.id);
		redirect(303, '/habits');
	}
};
