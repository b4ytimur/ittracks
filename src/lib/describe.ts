import type { ScheduleForm } from './forms';

export const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** What makes a group's day done: "All habits inside, or 2 for the Minimum". */
export function groupRuleText(s: { target: number | null; minimum: number | null }): string {
	const done = s.target === null ? 'Done when every habit inside is done' : `Done when ${s.target} habit${s.target === 1 ? '' : 's'} inside are done`;
	return s.minimum === null ? done : `${done}; ${s.minimum} for the Minimum`;
}

/**
 * A one-line, human description of a Schedule. A habit that follows its parent reads better
 * with the parent's name and Variant names.
 */
export function describeSchedule(s: ScheduleForm | null, parent?: { name: string; variants?: { id: string; name: string }[] }): string {
	if (!s) return 'No schedule';
	switch (s.kind) {
		case 'weekly': {
			const days = Object.keys(s.days)
				.map(Number)
				.sort()
				.map((d) => weekdayNames[d]);
			return days.length ? `Weekly on ${days.join(', ')}` : 'Weekly, no days set';
		}
		case 'frequency':
			return `${s.times} times a ${s.period}`;
		case 'interval':
			return s.every === 1 ? 'Every day' : `Every ${s.every} days`;
		case 'rotation':
			return s.step === 'week'
				? `Rotates weekly through ${s.order.length} Variants`
				: `Rotation of ${s.order.length} Variants with rest days`;
		case 'group':
			return groupRuleText(s);
		case 'follow': {
			const who = parent ? parent.name : 'the habit it sits in';
			if (!s.on) return `Whenever ${who} is due`;
			const names = s.on.map((id) => parent?.variants?.find((v) => v.id === id)?.name).filter((n): n is string => !!n);
			return names.length ? `When ${who} is due with ${names.join(' or ')}` : `On some of the days ${who} is due`;
		}
	}
}
