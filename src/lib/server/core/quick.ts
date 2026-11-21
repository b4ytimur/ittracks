// Quick-log links that carry a value, for Shortcuts, Siri, NFC tags, QR codes and widgets:
//   /q/<habit>?key=itk_…&value=250            add 250 to the habit's one number
//   /q/<habit>?key=itk_…&field=Minutes&value=20
//   /q/<habit>?key=itk_…                      done (copies the last log when it has Tasks)
//   /q/<break habit>?key=itk_…                a slip (value = how many), or &craving=1
// The same link works signed in without a key. A key needs the "log" access and, if it is
// limited to some habits, the habit has to be one of them.
import type { Level } from '$lib/engine/streak';
import { ActionError, requireScope, type Actor } from './actor';
import { findHabit } from './day';
import { addSlip, logDone, logValue, resistCraving, type DoneHow, type LogResult } from './log';

export interface QuickParams {
	value: string | null;
	field: string | null;
	task: string | null;
	mode: 'add' | 'set' | null;
	how: DoneHow | null;
	level: Level | null;
	date: string | null;
	extra: boolean;
	craving: boolean;
}

const one = <T extends string>(v: string | null, allowed: readonly T[]): T | null => (v && (allowed as readonly string[]).includes(v) ? (v as T) : null);

/** Read a link's options from its query string, or a posted form or JSON body. */
export function quickParams(get: (k: string) => string | null): QuickParams {
	const flag = (k: string) => ['1', 'true', 'yes'].includes((get(k) ?? '').toLowerCase());
	const value = get('value') ?? get('v');
	return {
		value: value === null || value.trim() === '' ? null : value.trim().slice(0, 20000),
		field: get('field')?.slice(0, 200) || null,
		task: get('task')?.slice(0, 200) || null,
		mode: one(get('mode'), ['add', 'set'] as const),
		how: one(get('how'), ['auto', 'targets', 'same', 'mark'] as const) ?? (flag('go') ? 'auto' : null),
		level: one(get('level'), ['minimum', 'target', 'stretch'] as const),
		date: get('date')?.slice(0, 10) || null,
		extra: flag('extra'),
		craving: flag('craving')
	};
}

/** Does the link log something, or (signed in, no value) just open the quick log screen? */
export const logsSomething = (p: QuickParams) => p.value !== null || p.how !== null || p.level !== null || p.craving;

export interface QuickOutcome {
	habit: string;
	/** One line to show or speak: "Drink water: 6 of 8 glasses". */
	message: string;
	/** A required field is still empty: the log screen should ask. */
	needsInput: boolean;
	occurrenceId: string | null;
	result: unknown;
}

const doneLine = (r: LogResult) =>
	r.status === 'done'
		? `${r.habit}: ${r.already ? 'already done' : 'done'}${r.progress ? ` (${r.progress})` : ''}`
		: r.missing?.length
			? `${r.habit}: fill in ${r.missing.join(', ')} in the app`
			: `${r.habit}: ${r.progress ?? r.status}`;

export function quickLog(actor: Actor, habitRef: string, p: QuickParams): QuickOutcome {
	requireScope(actor, 'log');
	const h = findHabit(actor, habitRef);
	if (h.direction === 'break') {
		if (p.craving) {
			const r = resistCraving(actor, { habit: h.id, date: p.date });
			return { habit: h.name, message: `${h.name}: craving resisted`, needsInput: false, occurrenceId: null, result: r };
		}
		const count = p.value === null ? 1 : Number(p.value);
		if (!Number.isInteger(count)) throw new ActionError('invalid', 'value must be a whole number of slips.');
		const r = addSlip(actor, { habit: h.id, date: p.date, count });
		return { habit: h.name, message: `${h.name}: ${count === 1 ? 'slip' : `${count} slips`} logged (${r.slipsThatDay} that day)`, needsInput: false, occurrenceId: null, result: r };
	}
	if (p.value !== null) {
		const r = logValue(actor, { habit: h.id, date: p.date, value: p.value, field: p.field, task: p.task, mode: p.mode ?? 'add', extra: p.extra });
		const line = r.progress ?? `${r.field.split(': ').pop()} ${r.value}`;
		return { habit: h.name, message: `${h.name}: ${line}${r.status === 'done' ? ' · done' : ''}`, needsInput: false, occurrenceId: r.occurrenceId, result: r };
	}
	const r = logDone(actor, { habit: h.id, date: p.date, how: p.how ?? 'auto', level: p.level, extra: p.extra });
	return { habit: h.name, message: doneLine(r), needsInput: !!r.missing?.length, occurrenceId: r.occurrenceId, result: r };
}

/**
 * The same link opened twice within a few seconds (a phone previewing it, then opening it)
 * logs once. Only for links followed with GET; a POST is always meant.
 */
const recent = new Map<string, { at: number; out: QuickOutcome }>();
const REPEAT_MS = 15_000;
export function once(key: string, run: () => QuickOutcome): QuickOutcome & { repeated?: boolean } {
	const now = Date.now();
	for (const [k, v] of recent) if (now - v.at > REPEAT_MS) recent.delete(k);
	const hit = recent.get(key);
	if (hit) return { ...hit.out, repeated: true };
	const out = run();
	recent.set(key, { at: now, out });
	return out;
}
