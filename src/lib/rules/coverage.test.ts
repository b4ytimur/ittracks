// Every field of every form must be listed in its rule registry, and nothing else.
// The type check already enforces this for forms with a TypeScript type; this test walks the
// real Zod schemas too, so a field added to a schema but not to the registry fails `npm test`.
// New form (for example view settings)? Add its schema and registry to REGISTRIES.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { habitForm, taskForm } from '../forms';
import { habitRules, slotRules } from './habit';
import { metricRules, taskRules } from './task';
import { viewRules } from './views';
import { viewSettings } from '../views';
import { cardRules, statsSettingsRules } from './stats';
import { statCard, statsSettings } from '../stats/model';

type Def = { type: string; innerType?: z.ZodType; shape?: Record<string, z.ZodType>; element?: z.ZodType; options?: z.ZodType[] };
const def = (s: z.ZodType) => (s as unknown as { def: Def }).def;

/** Unwrap defaults and optionals; report whether the value can be null. */
function unwrap(s: z.ZodType): { s: z.ZodType; nullable: boolean } {
	let nullable = false;
	for (;;) {
		const d = def(s);
		if (d.type === 'default' || d.type === 'optional' || d.type === 'prefault') s = d.innerType!;
		else if (d.type === 'nullable') {
			nullable = true;
			s = d.innerType!;
		} else return { s, nullable };
	}
}

/** The same paths as FieldPath<T>: plain non-null objects are split, everything else is one field. */
export function fieldPaths(schema: z.ZodType, prefix = ''): string[] {
	const shape = def(unwrap(schema).s).shape!;
	return Object.entries(shape).flatMap(([k, v]) => {
		const { s, nullable } = unwrap(v);
		return !nullable && def(s).type === 'object' ? fieldPaths(s, `${prefix}${k}.`) : [`${prefix}${k}`];
	});
}

const field = (schema: z.ZodType, path: string): z.ZodType => {
	let s = schema;
	for (const k of path.split('.')) {
		s = unwrap(s).s;
		const d = def(s);
		s = d.type === 'array' ? def(unwrap(d.element!).s).shape![k] : d.shape![k];
	}
	return s;
};

const slotSchema = def(unwrap(field(field(habitForm, 'variants'), 'slots')).s).element!;
const metricSchema = def(unwrap(field(taskForm, 'metrics')).s).element!;

const REGISTRIES: [string, z.ZodType, object][] = [
	['habit', habitForm, habitRules],
	['slot', slotSchema, slotRules],
	['task', taskForm, taskRules],
	['metric', metricSchema, metricRules],
	['views', viewSettings, viewRules],
	['stat card', statCard, cardRules],
	['stats settings', statsSettings, statsSettingsRules]
];

describe('rule registry coverage', () => {
	for (const [name, schema, rules] of REGISTRIES) {
		it(`${name}: every field has rules, and every rule names a real field`, () => {
			const fields = fieldPaths(schema).sort();
			const listed = Object.keys(rules).sort();
			expect({ missingRules: fields.filter((f) => !listed.includes(f)), unknownFields: listed.filter((l) => !fields.includes(l)) }).toEqual({
				missingRules: [],
				unknownFields: []
			});
		});

		it(`${name}: exclusive and requiresAny rules point at listed fields`, () => {
			const listed = new Set(Object.keys(rules));
			for (const [path, rule] of Object.entries(rules) as [string, { kind: string; other?: string; others?: string[] }[]][])
				for (const c of rule) {
					for (const o of [c.other, ...(c.others ?? [])].filter(Boolean)) expect(listed.has(o!), `${path} -> ${o}`).toBe(true);
				}
		});

		it(`${name}: exclusive pairs are declared on both sides, with at most one winner and a fix note`, () => {
			const all = rules as Record<string, { kind: string; other?: string; wins?: boolean; fixed?: string }[]>;
			for (const [path, rule] of Object.entries(all))
				for (const c of rule.filter((x) => x.kind === 'exclusive')) {
					const back = all[c.other!].find((x) => x.kind === 'exclusive' && x.other === path);
					expect(back, `${c.other} must also be exclusive with ${path}`).toBeTruthy();
					expect(c.wins && back!.wins, `${path} and ${c.other} can't both win`).toBeFalsy();
					// The side that loses in old data says what was fixed, for the note on the habit.
					if (back!.wins) expect(c.fixed, `${path} needs a "fixed" note`).toBeTruthy();
				}
		});
	}
});
