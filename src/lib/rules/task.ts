// Conflict rules for the Task editor and its Metrics. Ids (M1...) match the proposal.
import type { MetricForm, TaskForm } from '../forms';
import { check, defineRules, evaluate, independent, normalize, onlyWhen, type Issue } from './core';

export const isNumericType = (type: string) => type === 'number' || type === 'count' || type === 'duration';

export const metricRules = defineRules<MetricForm>({
	id: independent,
	name: independent,
	type: independent,
	repeats: independent,
	// M3: quick logs can't skip a required field, so it always shows there.
	quick: [onlyWhen((m) => m.quick || !m.required, 'Required fields always show on quick logs', true)],
	// M1: options that belong to one kind of Metric.
	unit: [onlyWhen((m) => isNumericType(m.type), 'Only numbers, counts and durations have a unit', '')],
	step: [onlyWhen((m) => isNumericType(m.type), 'Only numbers, counts and durations have a step', null)],
	choices: [
		onlyWhen((m) => m.type === 'choice', 'Only a Choice has options', []),
		check((m) => m.type === 'choice' && m.choices.length < 2, 'A Choice needs at least two options')
	],
	// M2: only numbers have targets to prefill from.
	prefill: [onlyWhen((m) => m.prefill !== 'target' || isNumericType(m.type), 'Only numbers have a target', 'last')],
	required: independent
});

export const taskRules = defineRules<TaskForm>({
	name: independent,
	notes: independent,
	tags: independent,
	metrics: independent, // each Metric is checked with metricRules
	subtasks: independent,
	areaId: independent,
	collectionIds: independent,
	// M4: a rest between sets needs sets.
	restTimerEnabled: [onlyWhen((t) => t.metrics.some((m) => m.repeats), 'A rest timer needs a field logged per set', false)],
	restTimerSeconds: independent
});

export function checkTask(input: TaskForm): { form: TaskForm; errors: Issue[]; warnings: Issue[] } {
	const metrics = input.metrics.map((m) => normalize(metricRules, m, undefined).form);
	const form = normalize(taskRules, { ...input, metrics }, undefined).form;
	const issues = [
		...evaluate(taskRules, form, undefined),
		...form.metrics.flatMap((m, i) => evaluate(metricRules, m, undefined, `metrics.${i}.`))
	];
	return {
		form,
		errors: issues.filter((i) => i.severity === 'block'),
		warnings: issues.filter((i) => i.severity === 'warn')
	};
}
