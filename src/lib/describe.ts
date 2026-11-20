import type { ScheduleForm } from './forms';

export const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A one-line, human description of a Schedule. */
export function describeSchedule(s: ScheduleForm | null): string {
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
	}
}
