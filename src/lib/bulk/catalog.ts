// The bulk actions, as data: what each one applies to, its input (one Zod schema for the app,
// the API and the MCP server), the access it needs, and how the app asks for it. The app's
// selection bar is built from this list, and the server runs each entry with its function in
// src/lib/server/bulk. A new bulk action is one entry here and one function there; a new
// bulk-editable habit field is one entry in `habitBulk` (src/lib/rules/habit.ts).
import { z } from 'zod';
import { isRealDate } from '$lib/engine/backfill';
import { UNITS } from '$lib/units';
import { habitBulk, type HabitBulkField } from '$lib/rules/habit';
import type { FieldSpec } from './fields';

/** What a selection is made of. */
export const TARGETS = {
	habit: { one: 'habit', many: 'habits' },
	task: { one: 'Task', many: 'Tasks' }
} as const;
export type TargetKind = keyof typeof TARGETS;

/** A selection as data: these ids (or names), or every item that matches a filter. */
export const selectionInput = {
	ids: z.array(z.string().trim().min(1).max(200)).min(1).max(1000).optional().describe('The habits or Tasks to change, by id (or name).'),
	filter: z
		.object({
			area: z.string().max(200).optional().describe('Only items in this Area (id or name).'),
			direction: z.enum(['build', 'break']).optional().describe('Habits: only build or only break habits.'),
			tag: z.string().max(100).optional().describe('Tasks: only Tasks with this tag.'),
			archived: z.boolean().optional().describe('Include archived items too. Default false.')
		})
		.optional()
		.describe('Instead of ids: every habit or Task that matches. {} is all of them.')
};

const day = z.string().refine(isRealDate, 'Use a date as YYYY-MM-DD');
const range = (what: string) => ({
	from: day.describe(`First day ${what}, YYYY-MM-DD.`),
	to: day.describe(`Last day ${what}, YYYY-MM-DD.`)
});

export interface BulkMeta {
	target: TargetKind;
	/** Access a key needs, besides log access for the bulk action itself. */
	scope: 'log' | 'edit';
	title: string;
	description: string;
	input: z.ZodObject;
	/** How the app asks for the input; empty for actions it builds per field (set). */
	fields: FieldSpec[];
}

const setShape = Object.fromEntries(Object.entries(habitBulk).map(([k, f]) => [k, f.input.optional()])) as {
	[K in HabitBulkField]: z.ZodOptional<(typeof habitBulk)[K]['input']>;
};

export const BULK = {
	skip_days: {
		target: 'habit',
		scope: 'log',
		title: 'Skip days',
		description:
			'Skip every due day of the habits from `from` to `to` (a sick week). Days already done stay done; days after today are left out (pause those instead). A skip neither adds to nor breaks a streak.',
		input: z.object(range('to skip')),
		fields: [
			{ key: 'from', label: 'From', kind: 'date', initial: -2 },
			{ key: 'to', label: 'To', kind: 'date', initial: 0 }
		]
	},
	pause: {
		target: 'habit',
		scope: 'edit',
		title: 'Pause',
		description: 'Pause the habits for a date range: paused days are not due and never count as missed. A pause over past days takes back the misses counted for them.',
		input: z.object({ ...range('of the pause'), note: z.string().max(120).optional().describe('Why, shown with the pause.') }),
		fields: [
			{ key: 'from', label: 'From', kind: 'date', initial: 1 },
			{ key: 'to', label: 'To', kind: 'date', initial: 7 },
			{ key: 'note', label: 'Note', kind: 'text', placeholder: 'Holiday, sick…', optional: true }
		]
	},
	set: {
		target: 'habit',
		scope: 'edit',
		title: 'Change a setting',
		description: `Set fields on every habit at once: ${Object.entries(habitBulk)
			.map(([k, f]) => `${k} (${f.label})`)
			.join(', ')}. Habits a setting can't apply to (a reminder needs a time) are left as they are, with the reason.`,
		input: z.object({
			set: z
				.object(setShape)
				.refine((s) => Object.values(s).some((v) => v !== undefined), 'Set at least one field')
				.describe('The fields to set and their new values.')
		}),
		fields: []
	},
	convert_unit: {
		target: 'task',
		scope: 'edit',
		title: 'Change a unit',
		description:
			'Change the unit of the field called `field` in every Task, e.g. every Weight field from kg to lb. values "convert" converts past values and targets (units of one kind only: kg and lb, km and mi, min and h); "relabel" keeps the numbers.',
		input: z.object({
			field: z.string().trim().min(1).max(200).describe('The field name, matched in any case: "Weight".'),
			to: z.string().trim().max(20).describe('The new unit: lb, kg, km, mi, min, h… or any word.'),
			values: z.enum(['convert', 'relabel']).describe('What happens to past values: converted, or the numbers kept.')
		}),
		fields: [
			{ key: 'field', label: 'Field', kind: 'select', source: 'fields' },
			{ key: 'to', label: 'New unit', kind: 'text', placeholder: 'lb', suggest: 'units' },
			{
				key: 'values',
				label: 'Past values',
				kind: 'choice',
				options: [
					{ value: 'convert', label: 'Convert them (60 kg becomes 132.277 lb)' },
					{ value: 'relabel', label: 'Keep the numbers (60 kg becomes 60 lb)' }
				],
				initial: 'convert'
			}
		]
	}
} satisfies Record<string, BulkMeta>;

export type BulkName = keyof typeof BULK;
export const BULK_NAMES = Object.keys(BULK) as [BulkName, ...BulkName[]];

/** One action as the bulk input names it: { name: 'skip_days', from, to }. */
export const bulkAction = z.discriminatedUnion(
	'name',
	BULK_NAMES.map((name) => BULK[name].input.extend({ name: z.literal(name) })) as unknown as [z.ZodObject<{ name: z.ZodLiteral<BulkName> }>, ...z.ZodObject<{ name: z.ZodLiteral<BulkName> }>[]]
);

/** The core `bulk` action's input. */
export const bulkInput = z.object({
	action: bulkAction.describe(`The change, with its own input: ${BULK_NAMES.map((n) => `${n} (${BULK[n].title})`).join(', ')}.`),
	...selectionInput,
	apply: z.boolean().optional().describe('false or left out: only preview. true: change everything in one go.')
});
export type BulkInput = z.infer<typeof bulkInput>;

// ---------- the app's selection bar ----------

/** A button on the selection bar: an action, the inputs it asks for, and how they become its input. */
export interface BulkButton {
	id: string;
	label: string;
	action: BulkName;
	fields: FieldSpec[];
	/** The action's input from the form's values. */
	toInput: (values: Record<string, unknown>) => Record<string, unknown>;
}

/** The buttons for a kind of selection: one per action, and one per bulk-editable field for `set`. */
export function buttonsFor(kind: TargetKind): BulkButton[] {
	const out: BulkButton[] = [];
	for (const name of BULK_NAMES) {
		const m: BulkMeta = BULK[name];
		if (m.target !== kind) continue;
		if (name === 'set')
			for (const [key, f] of Object.entries(habitBulk))
				out.push({
					id: `set:${key}`,
					label: f.label,
					action: 'set',
					fields: [{ ...f.editor, key: 'value', label: f.label } as FieldSpec],
					toInput: (v) => ({ set: { [key]: v.value } })
				});
		else out.push({ id: name, label: m.title, action: name, fields: m.fields, toInput: (v) => v });
	}
	return out;
}

/** Units for the unit field's suggestions. */
export const unitOptions = () => UNITS.map((u) => ({ value: u.key, label: u.key }));
