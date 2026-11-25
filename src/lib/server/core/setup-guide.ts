// What an assistant reads before it sets something up, one topic at a time, so the tool list it
// carries in every chat stays short. The shapes come from the same Zod schemas the editors and
// the setup action check against, so the guide can't drift from what is accepted.
import { z } from 'zod';
import { habitForm, taskForm } from '$lib/forms';
import { templateFile } from '$lib/template';
import { metricTypes } from '$lib/metric-types';

const schema = (s: z.ZodTypeAny) => {
	const { $schema: _s, ...rest } = z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
	void _s;
	return rest;
};

const OVERVIEW = {
	words: {
		Habit: 'Something to build (done or not each due day) or to break (log slips; the run resets). Has a schedule, Variants, a cue, a streak rule, optional Levels (Minimum / Target / Stretch).',
		Variant: 'A named version of a build habit, such as Workout A and Workout B. The schedule says which Variant is due on a day. A habit with one way of doing it has one Variant.',
		Slot: 'One line of a Variant: a Task with sets and targets (per field), or an auto-fill rule that picks a Task from the Library by its Tags.',
		Task: 'A reusable thing you do, kept in the Library (Bench press, Spanish lesson, Water). Its fields say what is logged.',
		Field: `What a Task logs (called metrics in the forms). Types: ${metricTypes.join(', ')}. perSet (repeats: true) means once per set or row, such as weight and reps; otherwise once per log, such as minutes. A choice field has options (and optional scores per option for charts).`,
		Part: 'What sits inside a Task: a step (a tick box) or another Library Task with its own sets and targets. A Task with parts and no per-set fields repeats in rounds (a circuit).',
		Schedule: 'When a build habit is due: weekly (fixed weekdays), frequency (N times a week or month), interval (every N days), rotation (Variants take turns, with rest days, or a cycle stepping by week), phases (schedules one after another: a program), group, follow (inside a routine).',
		Group: 'A habit whose days come from the habits inside it (schedule kind group); it is never logged itself.',
		Routine: 'A build habit with its own schedule and no Tasks of its own, with habits inside it that follow it (schedule kind follow). Done on it marks the habits inside.',
		Program: 'A habit with a phases schedule (a 4-week ramp-up, then maintain), often with habits inside. It travels as a template.',
		Template: 'A portable JSON file of one habit, the habits inside it and the Tasks they use, with local keys instead of ids. The Gallery has ready-made ones; any habit can be kept as one (save_template).',
		Area: 'A life area a habit or Task belongs to (Health, Learning). Named; a new name is added.'
	},
	workflow: [
		'1. Learn what exists: describe (habits, Tasks, fields), and the stats tools when advice should rest on the user\'s own data.',
		'2. Recommend: offer the user a few concrete options (schedule, size of the first step, Minimum level, cue) and let them choose. Prefer small starts.',
		'3. Draft the change: setup_read for a habit or Task to change (its form), or for templates to start from; this guide\'s topics for the shapes.',
		'4. Preview: call setup without apply. Read summary, warnings, and after. Show the user what will exist, in plain words, not JSON.',
		'5. Only when the user says yes: call setup again with the same changes, apply: true and the check. Then say what changed; setup_undo with the undo id takes it all back for a day.'
	],
	changes: {
		add_template: 'Best for anything new with new Tasks, several Variants, habits inside, or phases: a template file (topic "template"), or from: a ready-made template with answers.',
		add_habit: 'A new habit using Tasks already in the Library (named), or none (a plain yes/no habit). Topic "habit".',
		edit_habit: 'Replace some fields of a habit: setup_read habit:<name> first, then set only what changes.',
		add_task: 'A new Library Task. Topic "task".',
		edit_task: 'Replace some fields of a Task (fields, parts, tags, rest timer, words).',
		archive: 'Archive a habit or Task (logs stay), or bring it back with archived: false.',
		save_template: 'Keep a habit (with the habits inside it and its Tasks) in My templates in the Gallery.'
	},
	refs: 'In add_habit, edit_habit, add_task and edit_task, ids can be written as short keys ("A", "push") for new things, and Tasks, fields, habits, Areas and Variants can be named instead of using ids. A key on one change (key: "press") lets a later change in the same request use what it made. Everything in one request applies together or not at all.',
	topics: { habit: 'The habit form', task: 'The Task form', schedule: 'Every schedule kind with examples', template: 'The template file', examples: 'Worked requests for common goals' }
};

const SCHEDULES = {
	weekdays: '0 = Monday … 6 = Sunday.',
	dates: 'start may be left out or "today".',
	variants: 'Variants are named by key, id or name. A habit with one Variant may leave variantId out, and weekly days may be a list of weekdays.',
	kinds: {
		weekly: { example: { kind: 'weekly', days: { '0': 'A', '2': 'B', '4': 'A' } }, about: 'Fixed weekdays, each with its Variant.' },
		weeklyOne: { example: { kind: 'weekly', days: [0, 2, 4] }, about: 'Fixed weekdays, one Variant.' },
		frequency: { example: { kind: 'frequency', times: 3, period: 'week' }, about: 'N times a week or month, any days.' },
		interval: { example: { kind: 'interval', every: 1 }, about: 'Every N days from start; every: 1 is daily.' },
		rotation: {
			example: { kind: 'rotation', step: 'variant', order: [{ variantId: 'A', restDays: 1 }, { variantId: 'B', restDays: 2 }], onMiss: 'wait', weekdays: [] },
			about: 'Variants take turns: after A rest 1 day, then B, rest 2 days, then A again. weekdays limits which weekdays it may land on ([] = any). onMiss: wait (the missed Variant comes again) or skip (move on).'
		},
		cycle: { example: { kind: 'rotation', step: 'week', order: [{ variantId: 'Set A' }, { variantId: 'Set B' }], weekdays: [0, 3] }, about: 'Set A one week, Set B the next, on the given weekdays.' },
		phases: {
			example: { kind: 'phases', phases: [{ length: 2, unit: 'week', schedule: { kind: 'frequency', times: 2, period: 'week', variantId: 'Easy' } }, { length: null, unit: 'week', schedule: { kind: 'frequency', times: 3, period: 'week', variantId: 'Full' } }] },
			about: 'A program: each phase runs a schedule for its length; the last may have length null (no end).'
		},
		group: { example: { kind: 'group', target: null, minimum: null }, about: 'Due when a habit inside is due; done when all (target null) or target of them are done. Put habits in it with their parentId.' },
		follow: {
			example: { kind: 'follow', variantId: 'Main', on: null },
			about: 'For a habit inside a routine (parentId = the routine): due whenever the routine is, or only on the routine\'s Variants listed in on. map pairs routine Variant -> this habit\'s Variant.'
		},
		routineRule: { example: { rollup: { target: 2, minimum: 1 } }, about: 'Any own schedule of a routine may add rollup: done when target habits inside are done (null: all).' }
	}
};

export const EXAMPLES = [
	{
		goal: 'Learn Spanish: 15 minutes a day, at least 5 on a bad day, plus new words.',
		changes: [
			{
				op: 'add_template',
				template: {
					habit: {
						name: 'Spanish',
						direction: 'build',
						schedule: { kind: 'interval', every: 1, start: 'today', variantId: 'a' },
						variants: [{ key: 'a', name: 'Daily', slots: [{ task: 'study', targets: { mins: 15, words: 10 }, minTargets: { mins: 5 } }] }],
						levels: { enabled: true, minimum: '5 minutes', target: '15 minutes', stretch: '30 minutes' },
						cue: { time: '08:00', after: 'Coffee' }
					},
					tasks: [
						{
							key: 'study',
							name: 'Spanish study',
							metrics: [
								{ key: 'mins', name: 'Minutes', type: 'duration', unit: 'min' },
								{ key: 'words', name: 'New words', type: 'count' },
								{ key: 'what', name: 'What', type: 'choice', choices: ['App', 'Podcast', 'Book', 'Tutor'] }
							]
						}
					]
				}
			}
		]
	},
	{
		goal: 'Gym A/B: two workouts taking turns with a rest day between, weight and reps per set.',
		changes: [
			{
				op: 'add_template',
				template: {
					habit: {
						name: 'Gym',
						direction: 'build',
						schedule: { kind: 'rotation', step: 'variant', order: [{ variantId: 'A', restDays: 1 }, { variantId: 'B', restDays: 1 }], onMiss: 'wait', weekdays: [] },
						variants: [
							{ key: 'A', name: 'Workout A', slots: [{ task: 'squat', sets: 3, targets: { w: 60, r: 8 } }, { task: 'bench', sets: 3, targets: { w: 40, r: 8 } }] },
							{ key: 'B', name: 'Workout B', slots: [{ task: 'squat', sets: 3, targets: { w: 60, r: 8 } }, { task: 'row', sets: 3, targets: { w: 40, r: 10 } }] }
						]
					},
					tasks: [
						{ key: 'squat', name: 'Squat', restTimerEnabled: true, tags: [{ name: 'legs', level: 1 }], metrics: [{ key: 'w', name: 'Weight', type: 'number', unit: 'kg', repeats: true }, { key: 'r', name: 'Reps', type: 'count', repeats: true, times: true }] },
						{ key: 'bench', name: 'Bench press', restTimerEnabled: true, tags: [{ name: 'chest', level: 1 }, { name: 'triceps', level: 2 }], metrics: [{ key: 'w', name: 'Weight', type: 'number', unit: 'kg', repeats: true }, { key: 'r', name: 'Reps', type: 'count', repeats: true, times: true }] },
						{ key: 'row', name: 'Barbell row', restTimerEnabled: true, tags: [{ name: 'back', level: 1 }], metrics: [{ key: 'w', name: 'Weight', type: 'number', unit: 'kg', repeats: true }, { key: 'r', name: 'Reps', type: 'count', repeats: true, times: true }] }
					]
				}
			}
		],
		note: 'Field keys are per Task here (w, r), so two Tasks may reuse them. With reuse (the default) a Task named like one in the Library uses that one.'
	},
	{
		goal: 'Quit smoking, cutting down from 10 a day by 1 each week.',
		changes: [{ op: 'add_habit', habit: { name: 'No smoking', direction: 'break', limit: { max: 10, period: 'day', taper: { by: 1, every: 'week', floor: 0 } }, cost: { amount: 0.5, unit: '€' } } }]
	},
	{
		goal: 'A morning routine with three habits inside, done when at least two are done.',
		changes: [
			{ op: 'add_habit', key: 'morning', habit: { name: 'Morning routine', schedule: { kind: 'interval', every: 1, rollup: { target: 2, minimum: 1 } } } },
			{ op: 'add_habit', habit: { name: 'Make the bed', parentId: 'morning', schedule: { kind: 'follow', on: null } } },
			{ op: 'add_habit', habit: { name: 'Stretch 5 minutes', parentId: 'morning', schedule: { kind: 'follow', on: null } } },
			{ op: 'add_habit', habit: { name: 'Glass of water', parentId: 'morning', schedule: { kind: 'follow', on: null } } }
		]
	},
	{
		goal: 'Run three times a week instead of every day, from today on.',
		changes: [{ op: 'edit_habit', habit: 'Running', set: { schedule: { kind: 'frequency', times: 3, period: 'week' } } }],
		note: 'A habit with more than one Variant needs variantId. The past keeps its old plan unless scheduleApplies is "past".'
	},
	{
		goal: 'Add a choice of what kind of run (Easy, Tempo, Long) to the Run Task, which logs Distance and Time.',
		changes: [
			{
				op: 'edit_task',
				task: 'Run',
				set: { metrics: [{ name: 'Distance', type: 'number', unit: 'km' }, { name: 'Time', type: 'duration', unit: 'min' }, { name: 'Kind', type: 'choice', choices: ['Easy', 'Tempo', 'Long'] }] }
			}
		],
		note: 'metrics is replaced whole, so send every field the Task keeps. A field named like one it has keeps its id and its logged values.'
	}
];

const TOPICS = {
	overview: () => OVERVIEW,
	habit: () => ({
		about: 'The habit editor\'s form. add_habit fills what you leave out; edit_habit replaces only the fields in set. Variant and Slot ids may be short keys; Slot taskId may be a Task name; targets may be keyed by field name; parentId, cue.afterHabitId and ifThen.habitId may be habit names; areaId may be an Area name; identityIds may be statements ("I am a runner"); triggers (a break habit\'s feelings) may be plain words.',
		schema: schema(habitForm)
	}),
	task: () => ({
		about: 'The Task editor\'s form (the Library). Field (metric) ids may be left out or short keys; a field named like one the Task has keeps its id (and its logs). Choice options may be plain words; scores may be keyed by option name. parts may be step names, or {taskId: "<Task name>", sets, targets}. tags may be names.',
		schema: schema(taskForm)
	}),
	schedule: () => SCHEDULES,
	template: () => ({
		about: 'A template file. Keys (task, metric and Variant keys) are local to the file. format, version and name may be left out. Slots point at the file\'s tasks by key; targets are keyed by the Task\'s metric keys. children are habits inside the habit, each with a key and a parent key (null: inside the file\'s habit). questions are asked when it is added (answers on add_template).',
		schema: schema(templateFile)
	}),
	examples: () => ({ examples: EXAMPLES })
};
export type GuideTopic = keyof typeof TOPICS;
export const GUIDE_TOPICS = Object.keys(TOPICS) as [GuideTopic, ...GuideTopic[]];

export const setupGuide = (topic: GuideTopic = 'overview') => ({ topic, ...TOPICS[topic]() });
