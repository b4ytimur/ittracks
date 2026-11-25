// What someone wants, by a template's category. Apart from the templates, so the page doesn't carry them.
export const WANTS: Record<string, string> = {
	Gym: 'Get stronger',
	Cardio: 'Move more',
	Learning: 'Learn something',
	Health: 'Feel better',
	Mind: 'Calm the mind',
	Routine: 'Find a rhythm',
	Break: 'Stop something'
};
/** The order of the groups; anything else comes after. */
export const CATEGORY_ORDER = Object.keys(WANTS);
