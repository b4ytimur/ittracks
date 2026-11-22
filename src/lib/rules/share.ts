// Conflict rules for the "Share as template" form (src/lib/share.ts).
import type { ShareCtx, ShareForm } from '../share';
import { check, defineRules, evaluate, independent, onlyWhen, type Issue } from './core';

const questionCount = (f: ShareForm) => (f.askDays ? 1 : 0) + (f.askTime ? 1 : 0) + f.numbers.length;

export const shareRules = defineRules<ShareForm, ShareCtx>({
	name: independent,
	description: independent,
	category: independent,
	daysPerWeek: independent,
	minutesPerDay: independent,
	equipment: independent,
	includeArea: [onlyWhen((_f, c) => !!c.area, 'This habit has no Area', false)],
	includePool: [onlyWhen((_f, c) => c.pool > 0, 'No auto-filled Slot has Tasks in your Library to pick from', false)],
	suggestReminder: [onlyWhen((_f, c) => c.remind, 'The reminder is off for this habit', false)],
	includeNote: [onlyWhen((_f, c) => c.note, 'This habit has no note', false)],
	includeHowTo: [onlyWhen((_f, c) => c.howTo > 0, 'None of its Tasks has How to notes', false)],
	askDays: [
		onlyWhen(
			(_f, c) => c.daysFit,
			'Which days only fits a weekly schedule, a rotation by week or a number of times per week',
			false
		)
	],
	daysLabel: [onlyWhen((f) => f.askDays, 'Only used when you ask which days', 'Which days?')],
	askTime: [
		check(
			(f, c) => f.askTime && !!c.range,
			'The habit is set for a part of the day; the time someone picks replaces it',
			'warn'
		)
	],
	timeLabel: [onlyWhen((f) => f.askTime, 'Only used when you ask what time', 'What time?')],
	numbers: [
		check((f) => f.numbers.some((n) => !n.metrics.length), 'Pick at least one field for each number question'),
		check((f) => f.numbers.some((n) => !n.label.trim()), 'Each number question needs a question to ask'),
		check(
			(f) => {
				const all = f.numbers.flatMap((n) => n.metrics);
				return new Set(all).size !== all.length;
			},
			'A field can only be set by one number question'
		),
		check(
			(f) => f.numbers.some((n) => n.scale && n.default <= 0),
			'"In proportion" needs a starting number above 0; the answer will simply be the target',
			'warn'
		),
		check((f) => questionCount(f) > 10, 'A template can ask at most 10 questions')
	]
});

export function checkShare(f: ShareForm, c: ShareCtx): Issue[] {
	return evaluate(shareRules, f, c);
}
