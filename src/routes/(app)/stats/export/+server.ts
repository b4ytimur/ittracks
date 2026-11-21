// CSV downloads: one card (E1), or every log in the account (E3).
import { error } from '@sveltejs/kit';
import { boardsOf, ctxFor, statsContext } from '$lib/server/stats';
import { cardCsv, computeCard, toCsv, type Prepared } from '$lib/stats/engine';
import { habitCards } from '$lib/stats/auto';
import type { RequestHandler } from './$types';

const file = (name: string, body: string) =>
	new Response(body, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'stats'}.csv"`
		}
	});

/** Every value logged, one row per field per set, plus slips and cravings. */
function allLogs(P: Prepared): string[][] {
	const rows: string[][] = [['Date', 'Time', 'Habit', 'What', 'Level', 'Task', 'Set', 'Field', 'Value', 'Unit']];
	const logsByOcc = new Map<string, Prepared['logs']>();
	for (const l of P.logs) logsByOcc.set(l.occ.id, [...(logsByOcc.get(l.occ.id) ?? []), l]);
	const occs = [...P.ds.occurrences].filter((o) => o.status !== 'due').sort((a, b) => a.date.localeCompare(b.date));
	for (const o of occs) {
		const h = P.habits.get(o.habitId);
		if (!h) continue;
		const base = [o.date, o.time ?? '', h.name, o.status, o.status === 'done' ? (o.level ?? 'target') : ''];
		const logs = logsByOcc.get(o.id) ?? [];
		if (!logs.length) rows.push([...base, '', '', '', '', '']);
		for (const l of logs) {
			const ms = P.metricsByTask.get(l.task.id) ?? [];
			l.sets.forEach((s, i) => {
				for (const m of ms.filter((x) => x.repeats))
					if (s[m.id] !== undefined && s[m.id] !== null && s[m.id] !== '') rows.push([...base, l.task.name, String(i + 1), m.name, String(s[m.id]), m.unit ?? '']);
			});
			for (const m of ms.filter((x) => !x.repeats)) {
				const v = l.single[m.id];
				if (v !== undefined && v !== null && v !== '') rows.push([...base, l.task.name, '', m.name, String(v), m.unit ?? '']);
			}
			if (l.subsTotal) rows.push([...base, l.task.name, '', 'Steps done', `${l.subsDone} of ${l.subsTotal}`, '']);
			if (!l.sets.length && !ms.some((m) => !m.repeats && l.single[m.id] !== undefined) && !l.subsTotal) rows.push([...base, l.task.name, '', '', '', '']);
		}
	}
	for (const s of [...P.ds.slips].sort((a, b) => a.date.localeCompare(b.date)))
		rows.push([s.date, s.time ?? '', P.habits.get(s.habitId)?.name ?? '', 'slip', '', '', '', 'Count', String(s.count), '']);
	for (const c of [...P.ds.cravings].sort((a, b) => a.date.localeCompare(b.date)))
		rows.push([c.date, c.time ?? '', P.habits.get(c.habitId)?.name ?? '', 'craving resisted', '', '', '', '', '', '']);
	return rows;
}

export const GET: RequestHandler = ({ locals, url, cookies }) => {
	if (!locals.account) error(401);
	const accountId = locals.account.id;
	const { P, today } = statsContext(accountId, cookies.get('tz'));
	if (url.searchParams.get('all')) return file(`ittracks-logs-${today}`, toCsv(allLogs(P)));

	const s = boardsOf(accountId, P);
	const cardId = url.searchParams.get('card');
	const boardId = url.searchParams.get('board');
	const habitId = url.searchParams.get('habit');
	const board = boardId ? s.boards.find((b) => b.id === boardId) : undefined;
	const h = habitId ? P.habits.get(habitId) : undefined;
	const cards = board ? board.cards : h ? (s.habitCards[h.id] ?? habitCards(P, h)) : [];
	const card = cards.find((c) => c.id === cardId);
	if (!card) error(404, 'No such card');
	const r = computeCard(card, P, ctxFor(today, s, board));
	return file(`${card.title || 'card'}-${today}`, toCsv(cardCsv(card, r)));
};
