import { boardsOf, catalogFor, itemsFor, statsContext } from '$lib/server/stats';
import { getViews } from '$lib/server/settings';
import { BOARD_TEMPLATES, galleryCards, suggestedCards } from '$lib/stats/auto';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, cookies, url }) => {
	const accountId = locals.account!.id;
	const { P, today } = statsContext(accountId, cookies.get('tz'));
	const s = boardsOf(accountId, P);
	const hidden = getViews(accountId).hidden;
	const wanted = url.searchParams.get('board');
	const board =
		s.boards.find((b) => b.id === wanted) ??
		(s.open !== 'last' ? s.boards.find((b) => b.id === s.open) : undefined) ??
		s.boards.find((b) => b.id === s.last) ??
		s.boards[0] ??
		null;
	const catalog = catalogFor(accountId, P);
	return {
		today,
		boards: s.boards.map((b) => ({ id: b.id, name: b.name, cards: b.cards.length })),
		board,
		items: board ? itemsFor(board.cards, P, { catalog, stats: s, hidden, today, board }) : [],
		catalog,
		measures: s.measures,
		hidden,
		open: s.open,
		suggested: suggestedCards(P),
		gallery: galleryCards(),
		templates: Object.entries(BOARD_TEMPLATES).map(([id, t]) => ({ id, ...t })),
		logged: P.logs.length + P.ds.occurrences.filter((o) => o.status !== 'due').length + P.ds.slips.length
	};
};
