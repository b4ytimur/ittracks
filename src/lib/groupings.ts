// Groupings are yours: a name ("Muscle groups", "Skills", "Rooms"), its members (the tags a Task
// carries) and levels you name and weigh. Splitting a card by a grouping counts a log toward each
// of its Task's members by the level's weight; auto-fill compares levels by their order.
import { z } from 'zod';

const word = (max: number) => z.string().trim().min(1, 'A name is missing').max(max);

export const groupingLevel = z.object({
	/** What a Task's tag stores; never reused, so a renamed level keeps its Tasks. */
	id: z.number().int().min(1).max(99),
	name: word(30),
	/** How much a log counts toward a member at this level. */
	weight: z.number().min(0, 'A level counts nothing or more').max(100).finite(),
	/** Off your list, kept for the Tasks that still have it. */
	off: z.boolean().optional()
});
export const groupingSchema = z.object({
	id: z.string().max(40),
	name: word(40),
	/** What one of its members is called: "muscle group". */
	one: word(40),
	/** Strongest first. */
	levels: z.array(groupingLevel).min(1, 'A grouping needs a level').max(12)
});
export const groupingList = z.array(groupingSchema).min(1, 'There is always one grouping').max(20);
export type GroupingLevel = z.infer<typeof groupingLevel>;
export type Grouping = z.infer<typeof groupingSchema>;

export interface Weights {
	high: number;
	medium: number;
	low: number;
}
const levels = (w: Weights): GroupingLevel[] => [
	{ id: 3, name: 'high', weight: w.high },
	{ id: 2, name: 'medium', weight: w.medium },
	{ id: 1, name: 'low', weight: w.low }
];
export const DEFAULT_WEIGHTS: Weights = { high: 1, medium: 0.5, low: 0 };
/** What a new account starts with: one list of tags. */
export const starterGroupings = (): Grouping[] => [{ id: 'main', name: 'Tags', one: 'tag', levels: levels(DEFAULT_WEIGHTS) }];

/** An account's groupings as stored. Before they were stored, its tags with the three weights it had set. */
export function readGroupings(stored: unknown, weights: Weights = DEFAULT_WEIGHTS): Grouping[] {
	const ok = groupingList.safeParse(stored);
	return ok.success ? ok.data : [{ id: 'main', name: 'Muscle groups', one: 'muscle group', levels: levels(weights) }];
}

/** Why a list can't be, or ''. */
export function groupingsProblem(gs: Grouping[]): string {
	const names = new Set<string>();
	for (const g of gs) {
		if (names.has(g.name.trim().toLowerCase())) return `Two groupings are called “${g.name}”`;
		names.add(g.name.trim().toLowerCase());
		if (g.levels.every((l) => l.off)) return `${g.name} needs a level`;
		const own = new Set<string>();
		for (const l of g.levels.filter((x) => !x.off)) {
			if (own.has(l.name.trim().toLowerCase())) return `${g.name} has two levels called “${l.name}”`;
			own.add(l.name.trim().toLowerCase());
		}
		if (new Set(g.levels.map((l) => l.id)).size < g.levels.length) return 'Two levels are the same one';
	}
	return '';
}

export interface GroupTable {
	groupings: Grouping[];
	/** The grouping a tag is in; the first one when it was never put in any. */
	of(tag: string): Grouping;
	/** The level's name, or its number when there is no such level. */
	levelName(tag: string, level: number): string;
	/** What a log counts toward the tag at this level. A level that isn't there counts as the nearest weaker one, else the weakest. */
	weight(tag: string, level: number): number;
	/** 0 for none, then 1 for the weakest level and up. */
	rank(tag: string, level: number): number;
}

/** `where` is the grouping each tag was put in, by its lower-case name. */
export function groupTable(groupings: Grouping[], where: Record<string, string | null> = {}): GroupTable {
	const byId = new Map(groupings.map((g) => [g.id, g]));
	const of = (tag: string) => byId.get(where[tag.trim().toLowerCase()] ?? '') ?? groupings[0];
	const at = (tag: string, level: number) => {
		const ls = of(tag).levels;
		return ls.find((l) => l.id === level) ?? [...ls].sort((a, b) => b.id - a.id).find((l) => l.id < level) ?? ls[ls.length - 1];
	};
	return {
		groupings,
		of,
		levelName: (tag, level) => at(tag, level).name,
		weight: (tag, level) => at(tag, level).weight,
		rank: (tag, level) => {
			if (level <= 0) return 0;
			const ls = of(tag).levels;
			return ls.length - ls.indexOf(at(tag, level));
		}
	};
}
