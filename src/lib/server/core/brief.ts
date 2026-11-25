// Schemas the tool list shows in short, as an object with one sentence instead of every field: for
// a shape spelled out elsewhere (in series, or in setup_guide), so each chat doesn't read it again.
// Input is still checked against the whole schema.
import type { z } from 'zod';

const BRIEF = new WeakMap<object, string>();

export const brief = <T extends z.ZodType>(schema: T, text: string) => (BRIEF.set(schema, text), schema);

/** z.toJSONSchema's override: a marked schema becomes `{ type: 'object', description }`. */
export const shortenBrief = ({ zodSchema, jsonSchema }: { zodSchema: unknown; jsonSchema: Record<string, unknown> }) => {
	const text = BRIEF.get(zodSchema as object);
	if (!text) return;
	for (const k of Object.keys(jsonSchema)) delete jsonSchema[k];
	Object.assign(jsonSchema, { type: 'object', description: text });
};
