// Changing Stats: boards, cards, a habit's Stats tab, the numbers on Today and the measures. One
// function for every change, used by the app (/api/stats) and by setup (core/setup.ts), so a card or
// measure an assistant makes is checked and saved exactly like one made by hand.
import { z } from 'zod';
import { boardsOf, catalogFor, getStats, saveStats, statsContext } from './stats';
import { getViews } from './settings';
import { cardRules, checkCard, checkStatsSettings } from '$lib/rules/stats';
import { normalize } from '$lib/rules/core';
import type { Prepared } from '$lib/stats/engine';
import { statCtx, type Catalog } from '$lib/stats/catalog';
import { formulaProblem } from '$lib/stats/formula';
import { boardFrom, habitCards, seedById } from '$lib/stats/auto';
import { manualOrder } from '$lib/views';
import { cardsUsing, board, boardFilter, customMeasure, MAX_BOARDS, MAX_CARDS, MAX_FILTER, newId, rangeValue, statCard, statsSettings, type BoardFilter, type StatCard, type StatsSettings } from '$lib/stats/model';
import { ActionError } from './core/actor';

const id = z.string().max(64);
/** Where a card lives: a board, or a habit's Stats tab. */
export const cardWhere = z.union([z.object({ board: id }), z.object({ habit: id })]);

const f = boardFilter.shape;
/** board.patch's filter: only the words it names change, so an Undo puts back its own words and keeps the ones changed since. */
const filterWords = z.object({ areas: f.areas.unwrap(), tags: f.tags.unwrap(), habit: f.habit.unwrap(), identity: f.identity.unwrap(), direction: f.direction.unwrap() }).partial();
/** board.patch's toggle: Areas or Tags on or off one by one in the filter, so its Undo turns back those and keeps the others.
 *  Each value is checked as its list checks it (an Area id, a Tag). */
const filterToggle = z.discriminatedUnion('list', [
	z.object({ list: z.literal('areas'), value: f.areas.unwrap().element, on: z.boolean() }),
	z.object({ list: z.literal('tags'), value: f.tags.unwrap().element, on: z.boolean() })
]);

export const statsChange = z.discriminatedUnion('op', [
	z.object({ op: z.literal('board.add'), template: z.string().max(40).refine((x) => !!seedById(x), 'No such board').nullable().default(null), name: z.string().trim().min(1).max(40).optional() }),
	z.object({ op: z.literal('board.patch'), id, name: z.string().trim().min(1).max(40).optional(), range: rangeValue.optional(), filter: filterWords.optional(), toggle: z.array(filterToggle).max(2 * MAX_FILTER).optional() }),
	z.object({ op: z.literal('board.delete'), id }),
	z.object({ op: z.literal('board.move'), id, dir: z.union([z.literal(-1), z.literal(1)]) }),
	/** Put the boards in this order (a tab dragged, or Move… in the Boards ⋯). Boards not listed keep their order after these. */
	z.object({ op: z.literal('board.order'), ids: z.array(id).max(MAX_BOARDS) }),
	/** Undo of board.delete: the board back in its place, and Stats opening with it again when it did. */
	z.object({ op: z.literal('board.restore'), board, index: z.number().int().min(0).max(MAX_BOARDS), open: z.boolean().default(false) }),
	z.object({ op: z.literal('card.save'), where: cardWhere, card: statCard, index: z.number().int().min(0).max(MAX_CARDS).optional() }),
	z.object({ op: z.literal('card.delete'), where: cardWhere, id }),
	/** Put the cards in this order (a card's ⠿ dragged or moved). Cards not listed keep their order after these. */
	z.object({ op: z.literal('card.order'), where: cardWhere, ids: z.array(id).max(MAX_CARDS) }),
	z.object({ op: z.literal('habit.reset'), habit: id }),
	/** Undo of habit.reset: the habit's own cards back, and its Today number unless one was picked since. */
	z.object({ op: z.literal('habit.restore'), habit: id, cards: z.array(statCard).max(MAX_CARDS), headline: statCard.nullable().default(null) }),
	z.object({ op: z.literal('open'), value: id }),
	z.object({ op: z.literal('last'), id }),
	z.object({ op: z.literal('headline'), habit: id, card: statCard.nullable() }),
	z.object({ op: z.literal('measure.save'), measure: customMeasure }),
	z.object({ op: z.literal('measure.delete'), id })
]);
export type StatsChange = z.infer<typeof statsChange>;

export interface StatsChanged {
	stats: StatsSettings;
	/** The board, card or measure the change made or saved. */
	id?: string;
	/** measure.delete: how many cards still count by it (then it is turned off, not deleted). */
	used: number;
	warnings: string[];
	/** Nothing to save (`last` was already that board). */
	same?: true;
}

/** Check a card against the rules and clear what can't apply. Gives the blocking reason instead when a rule refuses it. */
export function tryClean(card: StatCard, catalog: Catalog, s: StatsSettings, hidden: string[]): StatCard | string {
	const ctx = statCtx(card, catalog, { hidden, measures: s.measures });
	const fixed = normalize(cardRules, card, ctx).form;
	const block = checkCard(fixed, ctx).find((i) => i.severity === 'block');
	return block ? block.reason : statCard.parse(fixed);
}

function cleanCard(card: StatCard, catalog: Catalog, s: StatsSettings, hidden: string[]): StatCard {
	const c = tryClean(card, catalog, s, hidden);
	if (typeof c === 'string') throw new ActionError('invalid', c);
	return c;
}

/** A card as Today shows it: always a single number. */
const asTile = (card: StatCard): StatCard => ({ ...card, look: { ...card.look, chart: 'tile' } });

/** A card made on a habit's Stats tab reads that habit, unless it picked habits itself. */
const forHabit = (card: StatCard, habitId: string): StatCard =>
	card.filter.habits.length ? card : { ...card, filter: { ...card.filter, habits: [habitId] } };

const move = <T>(xs: T[], i: number, dir: number) => {
	const j = i + dir;
	if (i < 0 || j < 0 || j >= xs.length) return xs;
	const out = [...xs];
	[out[i], out[j]] = [out[j], out[i]];
	return out;
};

const notFound = (what: string) => new ActionError('not_found', what);

/** The changes that read logs to work out cards. */
const NEEDS_DATA = ['board.add', 'card.save', 'card.delete', 'card.order', 'habit.reset', 'habit.restore', 'headline'];

/**
 * Apply one Stats change and save it. Throws ActionError for a change that can't apply (not_found
 * for a board, habit or card that isn't there; invalid for one a rule refuses).
 */
export function changeStats(accountId: string, raw: unknown, tz?: string): StatsChanged {
	const parsed = statsChange.safeParse(raw);
	if (!parsed.success) throw new ActionError('invalid', `Not a stats change: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`.trim());
	const b = parsed.data;
	const hidden = getViews(accountId).hidden;
	const P: Prepared | null = NEEDS_DATA.includes(b.op) ? statsContext(accountId, tz).P : null;
	let s = P ? boardsOf(accountId, P) : getStats(accountId);
	let added: string | undefined;
	let used = 0;

	/** The cards at `w`, and a setter that writes them back. */
	const cardsAt = (w: z.infer<typeof cardWhere>): [StatCard[], (cards: StatCard[]) => void] => {
		if ('board' in w) {
			const bd = s.boards.find((x) => x.id === w.board);
			if (!bd) throw notFound('No such board');
			return [bd.cards, (cards) => (s = { ...s, boards: s.boards.map((x) => (x.id === bd.id ? { ...x, cards } : x)) })];
		}
		const h = P!.habits.get(w.habit);
		if (!h) throw notFound('No such habit');
		const auto = habitCards(P!, h);
		return [
			s.habitCards[h.id] ?? auto,
			(cards) => {
				// Cards that are the automatic ones again (the Undo of the first change) are not your own: the tab follows what it logs.
				const { [h.id]: _, ...rest } = s.habitCards;
				s = { ...s, habitCards: JSON.stringify(cards) === JSON.stringify(auto) ? rest : { ...rest, [h.id]: cards } };
			}
		];
	};

	/** Keep a habit's Today number in step with its cards: drop it when its card is gone. */
	const syncHeadline = (habitId: string, cards: StatCard[]) => {
		const hl = s.headlines[habitId];
		if (!hl || cards.some((c) => c.id === hl.id)) return;
		const { [habitId]: _, ...rest } = s.headlines;
		s = { ...s, headlines: rest };
	};

	switch (b.op) {
		case 'board.add': {
			if (s.boards.length >= MAX_BOARDS) throw new ActionError('invalid', `At most ${MAX_BOARDS} boards`);
			const nb = b.template ? boardFrom(seedById(b.template)!, P!) : board.parse({ id: newId(), name: b.name ?? 'New board', cards: [] });
			if (b.name) nb.name = b.name;
			added = nb.id;
			s = { ...s, boards: [...s.boards, nb], last: nb.id };
			break;
		}
		case 'board.patch': {
			if (!s.boards.some((x) => x.id === b.id)) throw notFound('No such board');
			const toggled = (f: BoardFilter): BoardFilter => {
				for (const t of b.toggle ?? []) {
					const list = f[t.list];
					if (t.on && list.includes(t.value)) continue;
					if (t.on && list.length >= MAX_FILTER) throw new ActionError('invalid', `A board filters by at most ${MAX_FILTER} Areas or Tags`);
					f = { ...f, [t.list]: t.on ? [...list, t.value] : list.filter((v) => v !== t.value) };
				}
				return f;
			};
			s = { ...s, boards: s.boards.map((x) => (x.id === b.id ? { ...x, name: b.name ?? x.name, range: b.range ?? x.range, filter: toggled({ ...x.filter, ...b.filter }) } : x)) };
			break;
		}
		case 'board.delete':
			s = { ...s, boards: s.boards.filter((x) => x.id !== b.id), open: s.open === b.id ? 'last' : s.open, last: s.last === b.id ? null : s.last };
			break;
		case 'board.move':
			s = { ...s, boards: move(s.boards, s.boards.findIndex((x) => x.id === b.id), b.dir) };
			break;
		case 'board.order':
			s = { ...s, boards: manualOrder(s.boards, b.ids, (x) => x.id) };
			break;
		case 'board.restore': {
			if (s.boards.some((x) => x.id === b.board.id)) break;
			if (s.boards.length >= MAX_BOARDS) throw new ActionError('invalid', `At most ${MAX_BOARDS} boards`);
			const boards = [...s.boards];
			boards.splice(Math.min(b.index, boards.length), 0, b.board);
			// Opening with it again only while Stats still opens as the delete left it: a board picked since stays.
			s = { ...s, boards, open: b.open && s.open === 'last' ? b.board.id : s.open };
			break;
		}
		case 'card.save': {
			const catalog = catalogFor(accountId, P!);
			const card = cleanCard('habit' in b.where ? forHabit(b.card, b.where.habit) : b.card, catalog, s, hidden);
			const [cards, put] = cardsAt(b.where);
			const i = cards.findIndex((c) => c.id === card.id);
			if (i >= 0) put(cards.map((c) => (c.id === card.id ? card : c)));
			else {
				if (cards.length >= MAX_CARDS) throw new ActionError('invalid', `At most ${MAX_CARDS} cards on a board`);
				const next = [...cards];
				next.splice(b.index ?? next.length, 0, card);
				put(next);
			}
			added = card.id;
			// An edited card that is also the habit's Today number: Today shows the new version.
			if ('habit' in b.where && s.headlines[b.where.habit]?.id === card.id) {
				const tile = tryClean(asTile(card), catalog, s, hidden);
				if (typeof tile !== 'string') s = { ...s, headlines: { ...s.headlines, [b.where.habit]: tile } };
			}
			break;
		}
		case 'card.delete': {
			const [cards, put] = cardsAt(b.where);
			const left = cards.filter((c) => c.id !== b.id);
			put(left);
			if ('habit' in b.where) syncHeadline(b.where.habit, left);
			break;
		}
		case 'card.order': {
			const [cards, put] = cardsAt(b.where);
			put(manualOrder(cards, b.ids, (c) => c.id));
			break;
		}
		case 'habit.reset': {
			const { [b.habit]: _, ...rest } = s.habitCards;
			s = { ...s, habitCards: rest };
			const h = P!.habits.get(b.habit);
			// A Today number from an automatic card stays (its id is stable); one from your own card goes.
			syncHeadline(b.habit, h ? habitCards(P!, h) : []);
			break;
		}
		case 'habit.restore':
			if (!P!.habits.has(b.habit)) throw notFound('No such habit');
			// Cards made since the reset are the newer change: Undo never overwrites them.
			if (s.habitCards[b.habit]) throw new ActionError('conflict', 'Its cards changed since. Nothing was undone.');
			s = { ...s, habitCards: { ...s.habitCards, [b.habit]: b.cards } };
			if (b.headline && !s.headlines[b.habit]) s = { ...s, headlines: { ...s.headlines, [b.habit]: b.headline } };
			break;
		case 'open':
			if (b.value !== 'last' && !s.boards.some((x) => x.id === b.value)) throw new ActionError('invalid', 'No such board');
			s = { ...s, open: b.value };
			break;
		case 'last':
			if (s.last === b.id) return { stats: s, used, warnings: [], same: true };
			s = { ...s, last: b.id };
			break;
		case 'headline': {
			if (!P!.habits.has(b.habit)) throw notFound('No such habit');
			const { [b.habit]: _, ...rest } = s.headlines;
			// Only habits that are still there keep a Today number.
			const kept = Object.fromEntries(Object.entries(rest).filter(([k]) => P!.habits.has(k)));
			s = { ...s, headlines: b.card ? { ...kept, [b.habit]: cleanCard(asTile(forHabit(b.card, b.habit)), catalogFor(accountId, P!), s, hidden) } : kept };
			break;
		}
		case 'measure.save': {
			const m = b.measure;
			// The Measures line saves only a formula that reads.
			const problem = formulaProblem(m.formula);
			if (problem) throw new ActionError('invalid', `The formula “${m.formula}” can't be worked out: ${problem}`);
			const i = s.measures.findIndex((x) => x.id === m.id);
			s = { ...s, measures: i >= 0 ? s.measures.map((x) => (x.id === m.id ? m : x)) : [...s.measures, m] };
			added = m.id;
			break;
		}
		case 'measure.delete':
			// Cards that count by it keep it; unused, it goes.
			used = cardsUsing(s, b);
			s = { ...s, measures: used ? s.measures.map((x) => (x.id === b.id ? { ...x, off: true } : x)) : s.measures.filter((x) => x.id !== b.id) };
			break;
	}

	const checked = statsSettings.safeParse(s);
	if (!checked.success)
		throw new ActionError('invalid', checked.error.issues[0]?.code === 'too_big' ? `Stats holds at most ${MAX_BOARDS} boards and ${MAX_CARDS} cards on each` : 'That change could not be saved');
	const next = checked.data;
	const issues = checkStatsSettings(next);
	const block = issues.find((i) => i.severity === 'block');
	if (block) throw new ActionError('invalid', block.reason);
	saveStats(accountId, next);
	return { stats: next, id: added, used, warnings: issues.map((i) => i.reason) };
}
