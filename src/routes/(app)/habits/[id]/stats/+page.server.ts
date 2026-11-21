import { error } from '@sveltejs/kit';
import { ownedHabit } from '$lib/server/owned';
import { catalogFor, getStats, itemsFor, statsContext } from '$lib/server/stats';
import { getViews } from '$lib/server/settings';
import { galleryCards, habitCards, suggestedCards, taskCards, habitTasks } from '$lib/stats/auto';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, cookies }) => {
	const accountId = locals.account!.id;
	const owned = ownedHabit(accountId, params.id);
	if (!owned) error(404, 'Habit not found');
	const { P, today } = statsContext(accountId, cookies.get('tz'));
	const h = P.habits.get(owned.id)!;
	const s = getStats(accountId);
	const custom = s.habitCards[h.id];
	const cards = custom ?? habitCards(P, h);
	const hidden = getViews(accountId).hidden;
	const catalog = catalogFor(accountId, P);
	const only = { habits: [h.id] };
	return {
		habit: { id: h.id, name: h.name, direction: h.direction },
		customized: !!custom,
		items: itemsFor(cards, P, { catalog, stats: s, hidden, today, board: { range: '30d', filter: { areas: [], tags: [], habit: h.id, identity: null, direction: 'all' } } }),
		headline: s.headlines[h.id]?.id ?? null,
		catalog,
		measures: s.measures,
		hidden,
		// Cards for this habit first, then the gallery narrowed to it.
		suggested: [
			...suggestedCards(P).filter((g) => g.habitId === h.id),
			...habitTasks(P, h.id).map((t) => ({ group: t.name, cards: taskCards(P, t, { habitId: h.id }) }))
		],
		gallery: galleryCards().map((g) => ({ ...g, cards: g.cards.map((c) => ({ ...c, filter: { ...c.filter, ...only } })) }))
	};
};
