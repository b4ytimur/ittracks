// How the app asks for one input of a bulk action, as data. BulkForm.svelte renders any of
// these, so a new action or a new bulk-editable field needs no new form code.

export interface FieldOption {
	value: string;
	label: string;
}

export type FieldSpec = {
	/** The input's key in the action's input. */
	key: string;
	label: string;
	hint?: string;
} & (
	| { kind: 'date'; /** Days from today it starts at: 0 today, -1 yesterday. */ initial?: number }
	| { kind: 'select'; /** A list the page provides, such as "areas" or "fields". */ source: string; /** Shown for null; left out, a value is required. */ empty?: string }
	| { kind: 'choice'; options: FieldOption[]; initial?: string }
	| { kind: 'toggle'; on: string; off: string; initial?: boolean }
	| { kind: 'text'; placeholder?: string; optional?: boolean; /** A list the page provides, offered as suggestions. */ suggest?: string }
);

/** A field spec without its key and label: how to edit a value, wherever it sits. */
export type FieldEditor = FieldSpec extends infer F ? (F extends unknown ? Omit<F, 'key' | 'label'> : never) : never;

/** Option lists a page hands to the bulk bar, by source name. */
export type FieldSources = Record<string, FieldOption[]>;

/** A form's starting values. */
export function initialValues(fields: FieldSpec[], today: string, sources: FieldSources = {}): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const f of fields) {
		if (f.kind === 'date') out[f.key] = shift(today, f.initial ?? 0);
		else if (f.kind === 'toggle') out[f.key] = f.initial ?? true;
		else if (f.kind === 'choice') out[f.key] = f.initial ?? f.options[0]?.value ?? '';
		else if (f.kind === 'select') out[f.key] = f.empty !== undefined ? null : (sources[f.source]?.[0]?.value ?? '');
		else out[f.key] = '';
	}
	return out;
}

const shift = (d: string, n: number) => {
	const t = new Date(`${d}T00:00:00Z`);
	t.setUTCDate(t.getUTCDate() + n);
	return t.toISOString().slice(0, 10);
};
