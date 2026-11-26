// What a back link says: the page it goes to, named as its tab is, or the day for a past day (TS.15). Never just "Back".
const TABS: Record<string, string> = { '': 'Today', habits: 'Habits', library: 'Library', history: 'History', journal: 'History', stats: 'Stats', settings: 'Settings' };

export function backLabel(href: string): string {
	const [, first = '', second] = href.split(/[?#]/)[0].split('/');
	if (first === 'day') return second ? new Date(second + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' }) : 'Today';
	return TABS[first] ?? 'Back';
}
