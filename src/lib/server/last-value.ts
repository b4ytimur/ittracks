// The "last value" headline for a habit or tracker, read from its logs (engine/last.ts says it).
// Its main field is the first field logged once per log (a number, count, duration or choice) in
// its Slots, in their order: Weight in a weigh-in, Mood in a mood check.
import { and, asc, desc, eq, inArray, lte, ne } from 'drizzle-orm';
import { db } from './db';
import { entry, metric, occurrence, slot, variant } from './db/schema';
import { lastOf, lastText, type Last, type LastPoint } from '$lib/engine/last';
import { value as formatValue } from '$lib/stats/format';
import { optionName } from '$lib/options';

const MAIN_TYPES = new Set(['number', 'count', 'duration', 'choice']);

/** The habit's main field, or null when it logs no number or choice once per log. */
export function mainField(habitId: string) {
	const variants = db
		.select({ id: variant.id })
		.from(variant)
		.where(and(eq(variant.habitId, habitId), eq(variant.archived, false)))
		.orderBy(asc(variant.sortOrder))
		.all();
	if (!variants.length) return null;
	const slots = db
		.select({ taskId: slot.taskId, variantId: slot.variantId })
		.from(slot)
		.where(inArray(slot.variantId, variants.map((v) => v.id)))
		.orderBy(asc(slot.sortOrder))
		.all()
		.sort((a, b) => variants.findIndex((v) => v.id === a.variantId) - variants.findIndex((v) => v.id === b.variantId));
	for (const s of slots) {
		if (!s.taskId) continue;
		const m = db
			.select()
			.from(metric)
			.where(and(eq(metric.taskId, s.taskId), eq(metric.archived, false), eq(metric.repeats, false)))
			.orderBy(asc(metric.sortOrder))
			.all()
			.find((x) => MAIN_TYPES.has(x.type));
		if (m) return m;
	}
	return null;
}

export interface LastValue extends Last {
	/** "82.4 kg · −0.6 kg in a week". */
	text: string;
	field: string;
	unit: string;
}

/** What the habit logged last in its main field, up to `today`; null when nothing is logged there yet. */
export function lastValue(habitId: string, today: string): LastValue | null {
	const m = mainField(habitId);
	if (!m) return null;
	const rows = db
		.select({ date: occurrence.date, values: entry.values })
		.from(entry)
		.innerJoin(occurrence, eq(entry.occurrenceId, occurrence.id))
		.where(and(eq(occurrence.habitId, habitId), eq(entry.taskId, m.taskId), ne(occurrence.status, 'skipped'), lte(occurrence.date, today)))
		.orderBy(desc(occurrence.date))
		.limit(400)
		.all();
	const points: LastPoint[] = [];
	for (const r of rows) {
		const v = (r.values as Record<string, unknown> | null)?.[m.id];
		if (typeof v === 'number' && Number.isFinite(v)) points.push({ date: r.date, value: v });
		else if (m.type === 'choice' && typeof v === 'string') points.push({ date: r.date, value: v });
	}
	const last = lastOf(points);
	if (!last) return null;
	const unit = (m.unit ?? '').trim();
	const say = (v: number | string) =>
		typeof v === 'string' ? (optionName(m.choices, v) ?? '') : formatValue(v, m.type === 'duration' ? unit || 'min' : unit, m.type === 'duration' ? 'duration' : 'number');
	return { ...last, text: lastText(last, today, say), field: m.name, unit };
}
