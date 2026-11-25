// A habit from the sentence it was said in: the habit, the Task its amount is logged on, and the part
// of the day it names. Its Undo takes all of it back.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { firstError, habitForm, noteDefaults, rowWords, taskForm, type ScheduleForm } from '$lib/forms';
import { DEFAULT_RANGES } from '$lib/engine/day';
import { overlappingRanges } from '$lib/rules/settings';
import { saveHabit } from './repo/habits';
import { saveTask } from './repo/tasks';
import { getSettings, getUnits, saveSettings } from './settings';
import { trash } from './trash';

export const saidSchema = z.object({
	name: z.string().trim().min(1, 'Say what you want to track').max(120),
	amount: z.number().positive().max(1e9).nullable(),
	unit: z.string().trim().max(20).nullable(),
	days: z.discriminatedUnion('kind', [
		z.object({ kind: z.literal('every'), every: z.number().int().min(1).max(365) }),
		z.object({ kind: z.literal('days'), days: z.array(z.number().int().min(0).max(6)).min(1).max(7) }),
		z.object({ kind: z.literal('times'), times: z.number().int().min(1).max(31), period: z.enum(['week', 'month']) })
	]),
	part: z.enum(['Morning', 'Afternoon', 'Evening', 'Night']).nullable(),
	time: z
		.string()
		.regex(/^([01]\d|2[0-3]):[0-5]\d$/)
		.nullable(),
	stop: z.boolean()
});

/** The part's own name in the account, made when it isn't there; or the time it starts, when its hours are taken. */
function cueFor(accountId: string, part: string): { range: string } | { time: string } {
	const s = getSettings(accountId);
	const own = s.ranges.find((r) => r.name.trim().toLowerCase() === part.toLowerCase());
	if (own) return { range: own.name };
	const plain = DEFAULT_RANGES.find((r) => r.name === part)!;
	const next = [...s.ranges, plain];
	if (overlappingRanges(next) || next.length > 12) return { time: plain.start };
	saveSettings(accountId, { ranges: next });
	return { range: part };
}

export function startHabit(accountId: string, raw: unknown, today: string): { habit: string; task: string | null; name: string } | { error: string } {
	const p = saidSchema.safeParse(raw);
	if (!p.success) return { error: firstError(p.error) };
	const s = p.data;
	if (s.stop) {
		const f = habitForm.safeParse({ name: s.name, direction: 'break', startDate: today, variants: [], schedule: null });
		if (!f.success) return { error: firstError(f.error) };
		return { habit: saveHabit(accountId, null, f.data, today)!, task: null, name: s.name };
	}
	const variantId = randomUUID();
	const days = s.days;
	const schedule: ScheduleForm =
		days.kind === 'every'
			? { kind: 'interval', every: days.every, start: today, variantId }
			: days.kind === 'times'
				? { kind: 'frequency', times: days.times, period: days.period, variantId }
				: { kind: 'weekly', days: Object.fromEntries([...new Set(days.days)].map((d) => [String(d), variantId])) };
	let task: string | null = null;
	const metricId = randomUUID();
	if (s.amount !== null) {
		const units = getUnits(accountId);
		const type = units.isTime(s.unit) ? ('duration' as const) : units.find(s.unit) || !Number.isInteger(s.amount) ? ('number' as const) : ('count' as const);
		const field = s.unit && !units.find(s.unit) ? s.unit.charAt(0).toUpperCase() + s.unit.slice(1) : (units.kindOf(s.unit)?.name ?? 'Amount');
		const f = taskForm.safeParse({
			name: s.name,
			restTimerEnabled: false,
			restTimerSeconds: 90,
			...rowWords(),
			tags: [],
			parts: [],
			metrics: [{ id: metricId, name: field, type, unit: s.unit ?? '', repeats: false, choices: [], prefill: 'target', step: null, required: false, quick: true, ...noteDefaults() }]
		});
		if (!f.success) return { error: firstError(f.error) };
		task = saveTask(accountId, null, f.data);
	}
	const f = habitForm.safeParse({
		name: s.name,
		direction: 'build',
		startDate: today,
		variants: [{ id: variantId, name: 'Main', slots: task ? [{ id: randomUUID(), taskId: task, fillRule: null, sets: null, targets: { [metricId]: s.amount! } }] : [] }],
		schedule,
		cue: { time: s.time, place: null, afterHabitId: null, afterText: null, range: null, ...(s.part && !s.time ? cueFor(accountId, s.part) : {}) }
	});
	if (!f.success) return { error: firstError(f.error) };
	return { habit: saveHabit(accountId, null, f.data, today)!, task, name: s.name };
}

/** Take back what was just started: both go, for as long as a delete can be undone. */
export function unstart(accountId: string, habit: string, task: string | null, today: string): boolean {
	const gone = !!trash(accountId, 'habit', habit, today);
	if (task) trash(accountId, 'task', task, today);
	return gone;
}
