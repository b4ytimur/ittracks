// Conflict rules for the Task editor and its Metrics. Ids (M1...) match the proposal.
import type { MetricForm, TaskForm } from '../forms';
import { check, defineRules, evaluate, exclusive, independent, normalize, onlyWhen, type Issue } from './core';
import { archive, definePolicies, display, locked, migrate, pastIssues, removedItems, unguarded } from './history';
import { effectiveUnit, findUnit, unitChange, type UnitChange, type UnitChoice } from '../units';

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
	// Loops (a Task inside itself) and the depth cap need the account's other Tasks: checked
	// on save against all of them (repo/tasks.ts checkTaskLinks, engine/parts.ts checkParts).
	parts: [check((t) => t.parts.some((p) => p.kind === 'step' && !p.name.trim()), 'Give every step a name')],
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

// ---------- history: what an edit may do to data already logged (rules/history.ts) ----------

/** A field's unit as compared for a change: one key for every spelling ("lbs" is "lb"). */
const unitKey = (m: Pick<MetricForm, 'type' | 'unit'>) => {
	const u = effectiveUnit(m);
	return findUnit(u)?.key ?? u.toLowerCase();
};

export const metricPast = definePolicies<MetricForm>({
	id: locked('Logs point at a field by its id'),
	name: unguarded('Logs keep their values, but custom measures in Stats find fields by name, so a rename changes their results'),
	// Numbers, counts and durations all store a number, so they can switch; other kinds can't.
	type: locked(
		'This field has logged values, which would be read as another kind (a number as text, or as a tick). Add a new field instead',
		(from, to) => isNumericType(String(from)) && isNumericType(String(to))
	),
	unit: migrate<MetricForm>('Past values are converted to the new unit, or keep their numbers', unitKey),
	repeats: locked('This field has logged values. They were logged once or per set, and switching would read them the other way. Add a new field instead'),
	choices: unguarded('Past values are stored as the option text, so a renamed or removed option leaves them unmatched'),
	scores: unguarded('Numbers apply when Stats reads them, so a changed number changes past averages'),
	prefill: display(),
	step: display(),
	required: display(),
	quick: display(),
	long: display('Past text stays as it was written'),
	starter: display(),
	prompts: display('Each answer keeps the prompt it was written to'),
	promptOrder: display()
});

export const taskPast = definePolicies<TaskForm>({
	name: display(),
	notes: display(),
	tags: display('Past days keep the Tasks Fill rules picked for them'),
	metrics: archive('A field removed after it was logged is archived: its values stay in History and Stats'),
	// Past logs keep their place; their targets are read from the part as it is now.
	parts: archive('A step or Task removed after it was logged is archived: its past logs keep their place'),
	areaId: display(),
	collectionIds: display(),
	restTimerEnabled: display(),
	restTimerSeconds: display()
});

/** What has data logged against it: Metric ids with a value, part ids with anything logged under them. */
export interface TaskLogged {
	metrics: Set<string> | string[];
	parts: Set<string> | string[];
}

const has = (s: Set<string> | string[], id: string) => (Array.isArray(s) ? s.includes(id) : s.has(id));

/** A unit change on a field with logged values, and what can happen to them. */
export interface UnitEdit {
	metricId: string;
	name: string;
	from: string;
	to: string;
	change: Exclude<UnitChange, { kind: 'same' }>;
	/** What the user picked; null until they do. */
	choice: UnitChoice | null;
}

export interface TaskPast {
	/** Edits refused because of what is logged. */
	errors: Issue[];
	/** Unit changes that need (or have) the user's choice. */
	units: UnitEdit[];
	/** Metrics and parts the edit removes: archived when logged, deleted otherwise. */
	removed: Record<'metrics' | 'parts', { archive: string[]; drop: string[] }>;
}

/**
 * Check an edit of a Task against its history policies. `choices` holds the user's pick per
 * Metric id for a unit change on a field with logged values. Used by the editor (to grey out
 * and ask) and the server (to refuse, archive and convert).
 */
export function checkTaskPast(before: TaskForm, after: TaskForm, logged: TaskLogged, choices: Record<string, UnitChoice> = {}): TaskPast {
	const errors: Issue[] = [];
	const units: UnitEdit[] = [];
	after.metrics.forEach((m, i) => {
		const was = before.metrics.find((x) => x.id === m.id);
		if (!was) return;
		const issues = pastIssues(metricPast, was, m, has(logged.metrics, m.id), `metrics.${i}.`);
		const lockedOnes = issues.filter((x) => x.kind === 'locked');
		// A locked change is refused outright; its knock-on unit change needs no question.
		for (const issue of lockedOnes) errors.push({ path: issue.path, reason: `${m.name}: ${issue.reason}`, severity: 'block', rule: 'check' });
		if (lockedOnes.length) return;
		for (const issue of issues) {
			const from = effectiveUnit(was);
			const to = effectiveUnit(m);
			const change = unitChange(from, to);
			if (change.kind === 'same') continue;
			const choice = choices[m.id] ?? null;
			units.push({ metricId: m.id, name: m.name, from, to, change, choice });
			if (!choice)
				errors.push({ path: issue.path, reason: `Choose what happens to the values ${m.name} already has in ${from || 'no unit'}`, severity: 'block', rule: 'check' });
			else if (choice === 'convert' && change.kind !== 'convertible')
				errors.push({ path: issue.path, reason: `${from || 'No unit'} can't be converted to ${to || 'no unit'}. Keep the numbers, or add a new field`, severity: 'block', rule: 'check' });
		}
	});
	const removed = removedItems(taskPast, before, after, (path, id) => has(path === 'metrics' ? logged.metrics : logged.parts, id));
	return { errors, units, removed: { metrics: removed.metrics, parts: removed.parts } };
}
