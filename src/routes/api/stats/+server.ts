import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { catalogFor, ctxFor, getStats, statsContext } from '$lib/server/stats';
import { getViews } from '$lib/server/settings';
import { cardRules, checkCard } from '$lib/rules/stats';
import { normalize } from '$lib/rules/core';
import { computeCard, drill, unitOf } from '$lib/stats/engine';
import { statCtx } from '$lib/stats/catalog';
import { boardFilter, rangeValue, SHARE_MEASURES, statCard } from '$lib/stats/model';
import { changeStats, statsChange } from '$lib/server/stats-change';
import { ActionError } from '$lib/server/core/actor';
import type { RequestHandler } from './$types';

// The change itself is src/lib/server/stats-change.ts, shared with setup. Reads stay here.
const ctxIn = z.object({ range: rangeValue.default('30d'), filter: boardFilter.prefault({}) }).prefault({});
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const body = z.union([
	z.discriminatedUnion('op', [
		z.object({ op: z.literal('preview'), card: statCard, ctx: ctxIn }),
		z.object({ op: z.literal('drill'), card: statCard, ctx: ctxIn, from: isoDate, to: isoDate, series: z.string().max(200).nullable() })
	]),
	statsChange
]);

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

	try {
		const r = changeStats(accountId, b, tz);
		return json({ ok: true, id: r.id, used: r.used, warnings: r.warnings });
	} catch (e) {
		if (e instanceof ActionError) error(e.code === 'not_found' ? 404 : 400, e.message);
		throw e;
	}
};
