import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { boardsOf, catalogFor, ctxFor, getStats, saveStats, statsContext } from '$lib/server/stats';
import { getViews } from '$lib/server/settings';
import { cardRules, checkCard, checkStatsSettings } from '$lib/rules/stats';
import { normalize } from '$lib/rules/core';
import { computeCard, drill, unitOf, type Prepared } from '$lib/stats/engine';
import { statCtx, type Catalog } from '$lib/stats/catalog';
import { BOARD_TEMPLATES, boardTemplate, habitCards, type BoardTemplateId } from '$lib/stats/auto';
import { board, boardFilter, customMeasure, MAX_BOARDS, MAX_CARDS, newId, rangeValue, SHARE_MEASURES, statCard, statsSettings, type StatCard, type StatsSettings } from '$lib/stats/model';
import type { RequestHandler } from './$types';

const id = z.string().max(64);
/** Where a card lives: a board, or a habit's Stats tab. */
const where = z.union([z.object({ board: id }), z.object({ habit: id })]);
const ctxIn = z.object({ range: rangeValue.default('30d'), filter: boardFilter.prefault({}) }).prefault({});
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const body = z.discriminatedUnion('op', [
	z.object({ op: z.literal('board.add'), template: z.enum(Object.keys(BOARD_TEMPLATES) as [BoardTemplateId]).nullable().default(null), name: z.string().trim().min(1).max(40).optional() }),
	z.object({ op: z.literal('board.patch'), id, name: z.string().trim().min(1).max(40).optional(), range: rangeValue.optional(), filter: boardFilter.optional() }),
	z.object({ op: z.literal('board.delete'), id }),
	z.object({ op: z.literal('board.move'), id, dir: z.union([z.literal(-1), z.literal(1)]) }),
	z.object({ op: z.literal('board.restore'), board, index: z.number().int().min(0).max(MAX_BOARDS) }),
	z.object({ op: z.literal('card.save'), where, card: statCard, index: z.number().int().min(0).max(MAX_CARDS).optional() }),
	z.object({ op: z.literal('card.delete'), where, id }),
	z.object({ op: z.literal('card.move'), where, id, dir: z.union([z.literal(-1), z.literal(1)]) }),
	z.object({ op: z.literal('habit.reset'), habit: id }),
	z.object({ op: z.literal('open'), value: id }),
	z.object({ op: z.literal('last'), id }),
	z.object({ op: z.literal('headline'), habit: id, card: statCard.nullable() }),
	z.object({
		op: z.literal('settings'),
		muscle: statsSettings.shape.muscle.unwrap().partial().optional(),
		e1rm: z.string().max(300).optional(),
		e1rmMaxReps: z.number().int().min(1).max(30).optional()
	}),
	z.object({ op: z.literal('measure.save'), measure: customMeasure }),
	z.object({ op: z.literal('measure.delete'), id }),
	z.object({ op: z.literal('preview'), card: statCard, ctx: ctxIn }),
	z.object({ op: z.literal('drill'), card: statCard, ctx: ctxIn, from: isoDate, to: isoDate, series: z.string().max(200).nullable() })
]);

/** Check a card against the rules and clear what can't apply. Gives the blocking reason instead when a rule refuses it. */
function tryClean(card: StatCard, catalog: Catalog, s: StatsSettings, hidden: string[]): StatCard | string {
	const ctx = statCtx(card, catalog, { hidden, measures: s.measures });
	const fixed = normalize(cardRules, card, ctx).form;
	const block = checkCard(fixed, ctx).find((i) => i.severity === 'block');
	return block ? block.reason : statCard.parse(fixed);
}

/** tryClean, refusing the request when a rule blocks the card. */
function cleanCard(card: StatCard, catalog: Catalog, s: StatsSettings, hidden: string[]): StatCard {
	const c = tryClean(card, catalog, s, hidden);
	if (typeof c === 'string') error(400, c);
	return c;
}

/** A card as Today shows it: always a single number. */
const asTile = (card: StatCard): StatCard => ({ ...card, look: { ...card.look, chart: 'tile' } });

const move = <T,>(xs: T[], i: number, dir: number) => {
	const j = i + dir;
	if (i < 0 || j < 0 || j >= xs.length) return xs;
	const out = [...xs];
	[out[i], out[j]] = [out[j], out[i]];
	return out;
};

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	if (!locals.account) error(401);
	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Not a stats change');
	const accountId = locals.account.id;
	const b = parsed.data;
	const tz = cookies.get('tz');
	const hidden = getViews(accountId).hidden;

	// Reads first: they change nothing.
	if (b.op === 'preview' || b.op === 'drill') {
		const { P, today } = statsContext(accountId, tz);
		const s = getStats(accountId);
		const ctx = ctxFor(today, s, b.ctx);
		const catalog = catalogFor(accountId, P);
		const sc = statCtx(b.card, catalog, { hidden, measures: s.measures });
		const card = statCard.parse(normalize(cardRules, b.card, sc).form);
		if (b.op === 'drill') {
			// Each row is one log, so show it in the unit of one log, not of the card's total.
			const u = unitOf({ ...card, overTime: SHARE_MEASURES.includes(card.perLog) ? 'avg' : 'sum' }, P, ctx);
			return json({ rows: drill(card, P, ctx, { from: b.from, to: b.to }, b.series), unit: u.unit, kind: u.kind });
		}
		return json({ result: computeCard(card, P, ctx), issues: checkCard(card, sc), card });
	}

	const needsData = ['board.add', 'card.save', 'card.delete', 'card.move', 'habit.reset', 'headline'].includes(b.op);
	const P: Prepared | null = needsData ? statsContext(accountId, tz).P : null;
	let s = P ? boardsOf(accountId, P) : getStats(accountId);
	let added: string | undefined;

	/** The cards at `w`, and a setter that writes them back. */
	const cardsAt = (w: z.infer<typeof where>): [StatCard[], (cards: StatCard[]) => void] => {
		if ('board' in w) {
			const bd = s.boards.find((x) => x.id === w.board);
			if (!bd) error(404, 'No such board');
			return [bd.cards, (cards) => (s = { ...s, boards: s.boards.map((x) => (x.id === bd.id ? { ...x, cards } : x)) })];
		}
		const h = P!.habits.get(w.habit);
		if (!h) error(404, 'No such habit');
		return [s.habitCards[h.id] ?? habitCards(P!, h), (cards) => (s = { ...s, habitCards: { ...s.habitCards, [h.id]: cards } })];
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
			if (s.boards.length >= MAX_BOARDS) error(400, `At most ${MAX_BOARDS} boards`);
			const nb = b.template
				? boardTemplate(b.template, P!)
				: board.parse({ id: newId(), name: b.name ?? 'New board', cards: [] });
			if (b.name) nb.name = b.name;
			added = nb.id;
			s = { ...s, boards: [...s.boards, nb], last: nb.id };
			break;
		}
		case 'board.patch':
			if (!s.boards.some((x) => x.id === b.id)) error(404, 'No such board');
			s = {
				...s,
				boards: s.boards.map((x) =>
					x.id === b.id ? { ...x, name: b.name ?? x.name, range: b.range ?? x.range, filter: b.filter ?? x.filter } : x
				)
			};
			break;
		case 'board.delete':
			s = { ...s, boards: s.boards.filter((x) => x.id !== b.id), open: s.open === b.id ? 'last' : s.open, last: s.last === b.id ? null : s.last };
			break;
		case 'board.move':
			s = { ...s, boards: move(s.boards, s.boards.findIndex((x) => x.id === b.id), b.dir) };
			break;
		case 'board.restore': {
			if (s.boards.some((x) => x.id === b.board.id)) break;
			if (s.boards.length >= MAX_BOARDS) error(400, `At most ${MAX_BOARDS} boards`);
			const boards = [...s.boards];
			boards.splice(Math.min(b.index, boards.length), 0, b.board);
			s = { ...s, boards };
			break;
		}
		case 'card.save': {
			const catalog = catalogFor(accountId, P!);
			const card = cleanCard(b.card, catalog, s, hidden);
			const [cards, put] = cardsAt(b.where);
			const i = cards.findIndex((c) => c.id === card.id);
			if (i >= 0) put(cards.map((c) => (c.id === card.id ? card : c)));
			else {
				if (cards.length >= MAX_CARDS) error(400, `At most ${MAX_CARDS} cards on a board`);
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
		case 'card.move': {
			const [cards, put] = cardsAt(b.where);
			put(move(cards, cards.findIndex((c) => c.id === b.id), b.dir));
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
		case 'open':
			if (b.value !== 'last' && !s.boards.some((x) => x.id === b.value)) error(400, 'No such board');
			s = { ...s, open: b.value };
			break;
		case 'last':
			if (s.last === b.id) return json({ ok: true });
			s = { ...s, last: b.id };
			break;
		case 'headline': {
			if (!P!.habits.has(b.habit)) error(404, 'No such habit');
			const { [b.habit]: _, ...rest } = s.headlines;
			// Only habits that are still there keep a Today number.
			const kept = Object.fromEntries(Object.entries(rest).filter(([k]) => P!.habits.has(k)));
			s = { ...s, headlines: b.card ? { ...kept, [b.habit]: cleanCard(asTile(b.card), catalogFor(accountId, P!), s, hidden) } : kept };
			break;
		}
		case 'settings':
			s = { ...s, muscle: { ...s.muscle, ...(b.muscle ?? {}) }, e1rm: b.e1rm ?? s.e1rm, e1rmMaxReps: b.e1rmMaxReps ?? s.e1rmMaxReps };
			break;
		case 'measure.save': {
			const m = b.measure;
			const i = s.measures.findIndex((x) => x.id === m.id);
			s = { ...s, measures: i >= 0 ? s.measures.map((x) => (x.id === m.id ? m : x)) : [...s.measures, m] };
			added = m.id;
			break;
		}
		case 'measure.delete':
			s = { ...s, measures: s.measures.filter((x) => x.id !== b.id) };
			break;
	}

	const checked = statsSettings.safeParse(s);
	if (!checked.success)
		error(400, checked.error.issues[0]?.code === 'too_big' ? `Stats holds at most ${MAX_BOARDS} boards and ${MAX_CARDS} cards on each` : 'That change could not be saved');
	const next = checked.data;
	const issues = checkStatsSettings(next);
	const block = issues.find((i) => i.severity === 'block');
	if (block) error(400, block.reason);
	saveStats(accountId, next);
	return json({ ok: true, id: added, warnings: issues.map((i) => i.reason) });
};
