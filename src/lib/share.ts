// The "Share as template" form: what someone adds when they share a habit, such as a
// description, gallery details and questions the person adding it answers.
import { z } from 'zod';
import type { ScheduleForm } from './forms';
import type { ShareDetails, TemplateQuestion } from './template';

export const shareForm = z.object({
	name: z.string().trim().min(1).max(120),
	description: z.string().max(2000).default(''),
	category: z.string().max(40).default('Other'),
	daysPerWeek: z.number().min(0).max(7).nullable().default(null),
	minutesPerDay: z.number().int().min(0).max(600).nullable().default(null),
	equipment: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
	/** Carry the habit's and Tasks' Areas by name. */
	includeArea: z.boolean().default(true),
	/** Include the Library Tasks that auto-filled Slots pick from. */
	includePool: z.boolean().default(true),
	/** Suggest turning on the reminder (the person adding it decides). */
	suggestReminder: z.boolean().default(true),
	/** Send the habit's own note along. Off unless ticked: notes are private. */
	includeNote: z.boolean().default(false),
	/** Send the Tasks' How to notes along. */
	includeHowTo: z.boolean().default(true),
	/** Ask which weekdays. */
	askDays: z.boolean().default(false),
	daysLabel: z.string().max(200).default('Which days?'),
	/** Ask what time. */
	askTime: z.boolean().default(false),
	timeLabel: z.string().max(200).default('What time?'),
	/** Ask for starting numbers, each setting the targets of some fields. */
	numbers: z
		.array(
			z.object({
				label: z.string().trim().max(200),
				unit: z.string().max(20).default(''),
				/** Metric ids. */
				metrics: z.array(z.string().max(64)).max(50),
				default: z.number(),
				/** Keep lighter days, Minimum and Stretch in proportion. */
				scale: z.boolean().default(true)
			})
		)
		.max(8)
		.default([])
});
export type ShareForm = z.infer<typeof shareForm>;

/** What the share form needs to know about the habit. */
export interface ShareCtx {
	/** The days question can fill this schedule (weekly, rotation by week, times per week). */
	daysFit: boolean;
	/** The days the habit is on now, as the days question's default. 0 is Monday. */
	days: number[];
	/** The cue time, as the time question's default. */
	time: string | null;
	/** The habit is set for a part of the day. */
	range: string | null;
	area: string | null;
	/** Library Tasks the auto-filled Slots can pick. */
	pool: number;
	remind: boolean;
	/** The habit has a note of its own. */
	note: boolean;
	/** Tasks it would send that have How to notes. */
	howTo: number;
	/** Fields a number question can set. */
	metricIds: string[];
}

/** The weekdays a schedule is on, for the days question. */
export function scheduleDays(s: ScheduleForm | null): { fit: boolean; days: number[] } {
	if (s?.kind === 'weekly') return { fit: true, days: Object.keys(s.days).map(Number).sort() };
	if (s?.kind === 'rotation' && s.step === 'week') return { fit: true, days: [...s.weekdays].sort() };
	if (s?.kind === 'frequency' && s.period === 'week') {
		// Spread the times over the week, as a starting suggestion.
		const spread: Record<number, number[]> = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] };
		return { fit: true, days: spread[s.times] ?? [0, 1, 2, 3, 4, 5, 6] };
	}
	return { fit: false, days: [] };
}

/** What goes into the file, from the form. Questions the habit can't use are left out. */
export function shareDetails(f: ShareForm, c: ShareCtx): ShareDetails & { noPool: boolean } {
	const questions: TemplateQuestion[] = [];
	if (f.askDays && c.daysFit && c.days.length)
		questions.push({ kind: 'days', key: 'days', label: f.daysLabel.trim() || 'Which days?', default: c.days });
	if (f.askTime)
		questions.push({ kind: 'time', key: 'time', label: f.timeLabel.trim() || 'What time?', default: c.time ?? '07:00' });
	f.numbers.forEach((n, i) => {
		const metrics = n.metrics.filter((m) => c.metricIds.includes(m));
		if (metrics.length)
			questions.push({ kind: 'number', key: `n${i + 1}`, label: n.label.trim() || 'Starting number', unit: n.unit, default: n.default, metrics, scale: n.scale });
	});
	return {
		name: f.name,
		description: f.description.trim(),
		meta: { category: f.category.trim() || 'Other', daysPerWeek: f.daysPerWeek, minutesPerDay: f.minutesPerDay, equipment: f.equipment },
		questions,
		noArea: !f.includeArea,
		noRemind: !f.suggestReminder,
		withNote: f.includeNote,
		noHowTo: !f.includeHowTo,
		noPool: !f.includePool
	};
}
