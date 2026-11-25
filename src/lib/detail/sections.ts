// The sections of a habit's page and their order, the same on every habit of a kind.
export const SECTIONS = { what: 'What you do', counts: 'How it counts', slip: 'When you slip', keeps: 'What keeps you at it', about: 'About' } as const;
export type Section = keyof typeof SECTIONS;
export const KINDS = { build: 'habit', group: 'group', break: 'habit you break' } as const;
export type Kind = keyof typeof KINDS;

const ALL = Object.keys(SECTIONS) as Section[];
/** Every section, the saved ones first in their order, so one that isn't shown now keeps its place. */
export const everySection = (saved: readonly string[] = []): Section[] => [...ALL.filter((s) => saved.includes(s)).sort((a, b) => saved.indexOf(a) - saved.indexOf(b)), ...ALL.filter((s) => !saved.includes(s))];
/** The same list with the shown ones in this order. */
export function movedSections(full: Section[], shown: Section[]): Section[] {
	let i = 0;
	return full.map((s) => (shown.includes(s) ? shown[i++] : s));
}

/** The lines a habit's page shows once they hold something, per kind: each can be on every new one from the start. */
export const LINES_FOR = {
	build: ['when', 'remind', 'levels', 'streak', 'quick', 'raise', 'identity', 'treat', 'reward', 'prep', 'reframe', 'notes', 'inside'],
	group: ['when', 'streak', 'identity', 'treat', 'reward', 'prep', 'reframe', 'notes', 'inside'],
	break: ['instead', 'cost', 'identity', 'reframe', 'notes']
} as const satisfies Record<Kind, readonly string[]>;
