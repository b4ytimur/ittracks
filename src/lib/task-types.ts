// Starting points for a new Task: which Metrics it logs and whether it rests between sets.
import type { MetricType } from './metric-types';
import { noteDefaults } from './forms';
import { effectiveUnit, withShownUnits, type UnitTable } from './units';

export interface TaskTypeMetric {
	name: string;
	type: MetricType;
	unit: string;
	repeats: boolean;
	step: number | null;
	/** In a row it is written after a ×. */
	times?: boolean;
	/** Less is better. */
	better?: 'less';
}

export interface TaskType {
	key: string;
	name: string;
	description: string;
	metrics: TaskTypeMetric[];
	restTimerEnabled: boolean;
	/** Its own words, when "set" and "Rest" aren't them. */
	words?: { rowOne: string; rowMany: string; betweenName: string };
}

/** Built-in types. `{weight}` in a unit becomes the unit that kind is shown in. */
export const BUILTIN_TASK_TYPES: TaskType[] = [
	{
		key: 'strength',
		name: 'Strength',
		description: 'Weight and reps for each set, with a rest timer',
		restTimerEnabled: true,
		metrics: [
			{ name: 'Weight', type: 'number', unit: '{weight}', repeats: true, step: null },
			{ name: 'Reps', type: 'count', unit: '', repeats: true, step: 1, times: true }
		]
	},
	{
		key: 'bodyweight',
		name: 'Bodyweight',
		description: 'Reps for each set',
		restTimerEnabled: true,
		metrics: [{ name: 'Reps', type: 'count', unit: '', repeats: true, step: 1 }]
	},
	{
		key: 'cardio',
		name: 'Cardio',
		description: 'Time and distance',
		restTimerEnabled: false,
		metrics: [
			{ name: 'Time', type: 'duration', unit: 'min', repeats: false, step: 5 },
			{ name: 'Distance', type: 'number', unit: 'km', repeats: false, step: 0.5 }
		]
	},
	{
		key: 'study',
		name: 'Study',
		description: 'Minutes and how many items',
		restTimerEnabled: false,
		metrics: [
			{ name: 'Minutes', type: 'duration', unit: 'min', repeats: false, step: 5 },
			{ name: 'Items', type: 'count', unit: '', repeats: false, step: 1 }
		]
	},
	{
		key: 'timed',
		name: 'Timed',
		description: 'Just minutes, with the built-in timer',
		restTimerEnabled: false,
		metrics: [{ name: 'Minutes', type: 'duration', unit: 'min', repeats: false, step: 5 }]
	},
	{
		key: 'count',
		name: 'Count',
		description: 'One number, like glasses of water or pages',
		restTimerEnabled: false,
		metrics: [{ name: 'Count', type: 'count', unit: '', repeats: false, step: 1 }]
	},
	{
		key: 'check',
		name: 'Yes or no',
		description: 'Nothing to fill in, just done',
		restTimerEnabled: false,
		metrics: []
	}
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
