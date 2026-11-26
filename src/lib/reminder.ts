// A habit's reminder: when it comes, what it says, and what its notification offers.
import { z } from 'zod';

export const reminderForm = z.object({
	/** A time of its own; null follows When and where. */
	time: z
		.string()
		.regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Pick a time like 18:30')
		.nullable()
		.default(null),
	/** Its words; empty says where the cue is and what the Minimum is. */
	text: z.string().trim().max(120).default(''),
	/** The buttons besides Done. Minimum needs Levels. */
	minimum: z.boolean().default(true),
	snooze: z.boolean().default(true)
});
export type Reminder = z.infer<typeof reminderForm>;
export const noReminder = (): Reminder => ({ time: null, text: '', minimum: true, snooze: true });

export const SNOOZE_MIN = 30;

interface Of {
	cue: { time?: string | null; range?: string | null; place?: string | null } | null;
	reminder: Reminder | null;
	levels: { enabled: boolean; minimum: string } | null;
	/** A tracker ('track') has nothing to be done: its notification opens the log instead. */
	scoring?: string | null;
}

/** When it comes: its own time, the cue's, or when the cue's part of the day starts. Null: nothing to go by. */
export const reminderTime = (h: Of, ranges: { name: string; start: string }[]): string | null => h.reminder?.time ?? h.cue?.time ?? ranges.find((r) => r.name === h.cue?.range)?.start ?? null;

export function reminderBody(h: Of): string {
	const own = h.reminder?.text.trim();
	if (own) return own;
	const minimum = h.levels?.enabled && h.levels.minimum ? `Even ${h.levels.minimum} counts.` : '';
	return [[h.cue?.time ?? h.cue?.range, h.cue?.place].filter(Boolean).join(' '), minimum].filter(Boolean).join(' · ');
}

export function reminderActions(h: Of): { action: string; title: string }[] {
	return [
		h.scoring === 'track' ? { action: 'log', title: 'Log' } : { action: 'done', title: 'Done' },
		...(h.levels?.enabled && h.reminder?.minimum !== false ? [{ action: 'minimum', title: 'Minimum' }] : []),
		...(h.reminder?.snooze !== false ? [{ action: 'snooze', title: `Snooze ${SNOOZE_MIN} min` }] : [])
	];
}

/** "At 18:30. Says “Shoes on.” Offers Done and Snooze." */
export function reminderWords(h: Of & { remind: boolean }): string {
	if (!h.remind) return '';
	const when = h.reminder?.time ?? h.cue?.time;
	const acts = reminderActions(h).map((a) => a.title.split(' ')[0]);
	return [
		when ? `At ${when}.` : h.cue?.range ? `When the ${h.cue.range.toLowerCase()} starts.` : 'On.',
		h.reminder?.text.trim() ? `Says “${h.reminder.text.trim()}”` + (/[.!?]$/.test(h.reminder.text.trim()) ? '' : '.') : '',
		`Offers ${acts.length > 1 ? `${acts.slice(0, -1).join(', ')} and ${acts.at(-1)}` : acts[0]}.`
	]
		.filter(Boolean)
		.join(' ');
}
