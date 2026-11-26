import type { PlainScheduleForm, ScheduleForm } from './forms';
import { followVariant, phaseSpans, variantsIn, type Phases, type Schedule } from './engine/schedule';

export const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** What makes a group's day done: "All habits inside, or 2 for the Minimum". */
export function groupRuleText(s: { target: number | null; minimum: number | null }): string {
	const done = s.target === null ? 'Done when every habit inside is done' : `Done when ${s.target} habit${s.target === 1 ? '' : 's'} inside are done`;
	return s.minimum === null ? done : `${done}; ${s.minimum} for the Minimum`;
}

type Named = { id: string; name: string };

/** "1 week", "10 days". */
export const lengthText = (length: number, unit: 'day' | 'week') => `${length} ${unit}${length === 1 ? '' : 's'}`;

/**
 * A one-line, human description of a Schedule. A habit that follows its parent reads better
 * with the parent's name and Variant names; phases read better with the habit's own Variant
 * names (`own`), which they show when there is more than one.
 */
/**
 * A tracker's days, said as what they are: when it asks (its reminder, and the plan Today shows),
 * since it can be logged any day and nothing is ever due. "Asks every day", "Logged any day".
 */
export function describeAsks(s: ScheduleForm | PlainScheduleForm | null): string {
	if (!s || (s.kind === 'weekly' && !Object.keys(s.days).length)) return 'Logged any day';
	const text = describeSchedule(s);
	return `Asks ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

export function describeSchedule(
	s: ScheduleForm | PlainScheduleForm | null,
	parent?: { name: string; variants?: Named[] },
	own?: Named[]
): string {
	if (!s) return 'No schedule';
	switch (s.kind) {
		case 'phases': {
			const named = (p: PlainScheduleForm) => {
				const text = describeSchedule(p);
				if (!own || own.length < 2) return text;
				const names = variantsIn(p as Schedule)
					.map((id) => own.find((v) => v.id === id)?.name)
					.filter((n): n is string => !!n);
				return names.length ? `${text} (${names.join(', ')})` : text;
			};
			const shown = phaseSpans(s as Phases).map((span) => s.phases[span.index]);
			const parts = shown.map((p, i) => {
				const text = named(p.schedule);
				const first = i === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1);
				return p.length === null ? first : `${first} for ${lengthText(p.length, p.unit)}`;
			});
			const ends = shown.at(-1)?.length !== null;
			return `${parts.join(', then ')}${ends ? ', then it ends' : ''}`;
		}
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
			const names = s.on?.map((id) => parent?.variants?.find((v) => v.id === id)?.name).filter((n): n is string => !!n);
			const when = !s.on ? `Whenever ${who} is due` : names?.length ? `When ${who} is due with ${names.join(' or ')}` : `On some of the days ${who} is due`;
			// With a map: which of its own Variants each of the routine's brings up, by name.
			if (!s.map || !Object.keys(s.map).length) return when;
			const pairs = (s.on ?? parent?.variants?.map((v) => v.id) ?? Object.keys(s.map)).flatMap((p) => {
				const pn = parent?.variants?.find((v) => v.id === p)?.name;
				const cn = own?.find((v) => v.id === followVariant(s, p))?.name;
				return pn && cn ? [{ pn, cn }] : [];
			});
			if (!pairs.length) return when;
			if (pairs.every((x) => x.pn === x.cn)) return `${when}, with the Variant of the same name`;
			return `${when} (${pairs.map((x) => `${x.cn} on ${x.pn}`).join(', ')})`;
		}
	}
}
