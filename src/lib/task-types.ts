// Starting points for a new Task: which Metrics it logs and whether it rests between sets.
import type { MetricType } from './metric-types';

export interface TaskTypeMetric {
	name: string;
	type: MetricType;
	unit: string;
	repeats: boolean;
	step: number | null;
}

export interface TaskType {
	key: string;
	name: string;
	description: string;
	metrics: TaskTypeMetric[];
	restTimerEnabled: boolean;
}

/** Built-in types. `{weight}` in a unit becomes the user's default weight unit. */
export const BUILTIN_TASK_TYPES: TaskType[] = [
	{
		key: 'strength',
		name: 'Strength',
		description: 'Weight and reps for each set, with a rest timer',
		restTimerEnabled: true,
		metrics: [
			{ name: 'Weight', type: 'number', unit: '{weight}', repeats: true, step: null },
			{ name: 'Reps', type: 'count', unit: '', repeats: true, step: 1 }
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

/** Default plus and minus step for a Metric with no step of its own. */
export function defaultStep(type: string, unit: string | null): number {
	if (type === 'number') {
		const u = (unit ?? '').toLowerCase();
		if (u === 'kg') return 2.5;
		if (u === 'lb' || u === 'lbs') return 5;
		return 1;
	}
	if (type === 'duration') return 5;
	return 1;
}

/** Metrics for a type, with fresh ids and the user's weight unit filled in. */
export function metricsFromType(t: TaskType, weightUnit: string, newId: () => string = () => crypto.randomUUID()) {
	return t.metrics.map((m) => {
		const unit = m.unit.replace('{weight}', weightUnit);
		return {
			id: newId(),
			name: m.name,
			type: m.type,
			unit,
			repeats: m.repeats,
			choices: [] as string[],
			prefill: (m.type === 'text' ? 'blank' : 'last') as 'last' | 'target' | 'blank',
			step: m.step,
			required: false,
			quick: true
		};
	});
}
