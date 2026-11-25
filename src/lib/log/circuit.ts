// A Task whose parts repeat in rounds, as one place: its rounds are the rows, the parts its stations.
import { parentPath, parsePath } from '../engine/parts';

export interface Circuit {
	/** The Task itself, by its number in the log. */
	at: number;
	/** The stations of each round, in order, by their number in the log. */
	rounds: number[][];
}

/** Every Task of a log whose parts repeat and hold nothing themselves. Deeper ones stay places of their own. */
export function circuitsOf(items: { path: string; kids: number; inRows: boolean }[]): Map<number, Circuit> {
	const out = new Map<number, Circuit>();
	items.forEach((it, at) => {
		if (!it.kids || it.inRows) return;
		const rounds: number[][] = [];
		for (const [j, x] of items.entries()) {
			if (parentPath(x.path) !== it.path) continue;
			const n = parsePath(x.path).at(-2)?.round;
			if (!n || x.kids) return;
			(rounds[n - 1] ??= []).push(j);
		}
		if (rounds.length > 1 && rounds.every((r) => r.length === rounds[0].length)) out.set(at, { at, rounds });
	});
	return out;
}

/** What a round is called: the Task's own word for a row, unless it only has the plain one. */
export const roundWords = (t: { rowOne: string; rowMany: string }) => (['set', 'entry'].includes(t.rowOne) ? { one: 'round', many: 'rounds' } : { one: t.rowOne, many: t.rowMany });
