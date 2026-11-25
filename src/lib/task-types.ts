// Starting points for a new Task: which Metrics it logs and whether it rests between sets.
import { z } from 'zod';
import { metricTypes } from './metric-types';
import { noteDefaults } from './forms';
import { effectiveUnit, withShownUnits, type UnitTable } from './units';

export const taskTypeSchema = z.object({
	key: z.string().min(1).max(60),
	name: z.string().trim().min(1, 'Give it a name').max(40),
	description: z.string().max(200),
	restTimerEnabled: z.boolean(),
	/** Its own words; "entry", "entries" and "Pause" when left out. */
	words: z.object({ rowOne: z.string().trim().min(1).max(20), rowMany: z.string().trim().min(1).max(20), betweenName: z.string().trim().min(1).max(20) }).optional(),
	metrics: z
		.array(
			z.object({
				name: z.string().trim().min(1).max(120),
				type: z.enum(metricTypes),
				unit: z.string().max(20),
				repeats: z.boolean(),
				step: z.number().positive().nullable(),
				/** In a row it is written after a ×. */
				times: z.boolean().optional(),
				/** Less is better. */
				better: z.literal('less').optional()
			})
		)
		.max(20)
});
export type TaskType = z.infer<typeof taskTypeSchema>;
export type TaskTypeMetric = TaskType['metrics'][number];

/** The starting points that belong to no one kind of tracking. The rest come in packs (packs.ts). */
export const PLAIN_TASK_TYPES: TaskType[] = [
	{ key: 'count', name: 'Count', description: 'One number, like glasses of water or pages', restTimerEnabled: false, metrics: [{ name: 'Count', type: 'count', unit: '', repeats: false, step: 1 }] },
	{ key: 'timed', name: 'Timed', description: 'Just minutes, with the built-in timer', restTimerEnabled: false, metrics: [{ name: 'Minutes', type: 'duration', unit: 'min', repeats: false, step: 5 }] },
	{ key: 'check', name: 'Yes or no', description: 'Nothing to fill in, just done', restTimerEnabled: false, metrics: [] }
];

/** Default plus and minus step for a Metric with no step of its own: its unit's. */
export function defaultStep(type: string, unit: string | null, units: UnitTable): number {
	if (type === 'number') return units.stepOf(unit) ?? 1;
	if (type === 'duration') return units.stepOf(effectiveUnit({ type, unit })) ?? 5;
	return 1;
}

/** Metrics for a type, with fresh ids and the account's units filled in. */
export function metricsFromType(t: TaskType, units: UnitTable, newId: () => string = () => crypto.randomUUID()) {
	return t.metrics.map((m) => {
		const unit = withShownUnits(m.unit, units);
		return {
			id: newId(),
			name: m.name,
			type: m.type,
			unit,
			repeats: m.repeats,
			choices: [] as { id: string; name: string }[],
			prefill: (m.type === 'text' || m.type === 'checkbox' ? 'blank' : 'last') as 'last' | 'target' | 'blank',
			step: m.step,
			required: false,
			quick: true,
			...noteDefaults(),
			times: !!m.times,
			better: m.better ?? null
		};
	});
}
