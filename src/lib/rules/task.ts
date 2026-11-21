// Conflict rules for the Task editor and its Metrics. Ids (M1...) match the proposal.
import type { MetricForm, TaskForm } from '../forms';
import { check, defineRules, evaluate, exclusive, independent, normalize, onlyWhen, type Issue } from './core';

export const isNumericType = (type: string) => type === 'number' || type === 'count' || type === 'duration';
/** A Text field with several lines of Markdown. */
export const isLongText = (m: Pick<MetricForm, 'type' | 'long'>) => m.type === 'text' && m.long;
/** Some options of a Choice have a number and some don't. */
export const partlyScored = (m: Pick<MetricForm, 'choices' | 'scores'>) =>
	m.choices.some((c) => typeof m.scores[c] === 'number') && m.choices.some((c) => typeof m.scores[c] !== 'number');

export const metricRules = defineRules<MetricForm>({
	id: independent,
	name: independent,
	type: independent,
	// N2: a note box in every set row can't be used.
	repeats: [exclusive('long', "Several lines can't be logged per set", { wins: true })],
	// M3: quick logs can't skip a required field, so it always shows there.
	quick: [
		onlyWhen((m) => m.quick || !m.required, 'Required fields always show on quick logs', true),
		// N4: allowed, but a quick log is meant to be one tap.
		check((m) => isLongText(m) && m.quick && !m.required, 'A long text field makes quick logs slower. You can leave it off them', 'warn')
	],
	// M1: options that belong to one kind of Metric.
	unit: [onlyWhen((m) => isNumericType(m.type), 'Only numbers, counts and durations have a unit', '')],
	step: [onlyWhen((m) => isNumericType(m.type), 'Only numbers, counts and durations have a step', null)],
	choices: [
		onlyWhen((m) => m.type === 'choice', 'Only a Choice has options', []),
		check((m) => m.type === 'choice' && m.choices.length < 2, 'A Choice needs at least two options')
	],
	// J5: scored choices, so Stats can average a mood. Every option has a number, or none does.
	scores: [
		onlyWhen((m) => m.type === 'choice', 'Only a Choice has a number per option', {}),
		check((m) => m.type === 'choice' && partlyScored(m), 'Give every option a number, or none')
	],
	// N1: several lines (Markdown) only for Text fields.
	long: [
		onlyWhen((m) => m.type === 'text', 'Only a Text field can have several lines', false),
		exclusive('repeats', "Several lines can't be logged per set", { fixed: 'kept "Log per set" and turned off several lines' })
	],
	starter: [onlyWhen((m) => isLongText(m), 'Only a field with several lines starts with text', '')],
	// J4: prompts only on long text fields.
	prompts: [onlyWhen((m) => isLongText(m), 'Prompts only work on a field with several lines', [])],
	promptOrder: [onlyWhen((m) => isLongText(m) && m.prompts.length > 0, 'Add prompts first', 'order')],
	// M2: only numbers have targets to prefill from.
	// M5: a tick box always starts unticked, so last time's tick is never copied into a new log.
	prefill: [
		onlyWhen((m) => m.prefill !== 'target' || isNumericType(m.type), 'Only numbers have a target', 'last'),
		onlyWhen((m) => m.prefill === 'blank' || m.type !== 'checkbox', 'A tick box always starts unticked', 'blank'),
		// N3: never last time's journal entry copied into today's.
		onlyWhen((m) => m.prefill === 'blank' || !isLongText(m), "A field with several lines starts blank or with its starter text, never with last time's text", 'blank')
	],
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

/** Numbers only for options the Choice still has (an option renamed or removed loses its number). */
const keepScores = (m: MetricForm): MetricForm => ({
	...m,
	scores: Object.fromEntries(Object.entries(m.scores ?? {}).filter(([k, v]) => m.choices.includes(k) && Number.isFinite(v)))
});

export function checkTask(input: TaskForm): { form: TaskForm; errors: Issue[]; warnings: Issue[] } {
	const metrics = input.metrics.map((m) => normalize(metricRules, keepScores(m), undefined).form);
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
