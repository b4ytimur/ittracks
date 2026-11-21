import { error, json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getViews, saveViews } from '$lib/server/settings';
import { PAGES, savedView, switchTemplate, templateById, viewSettings, viewState, type ViewSettings } from '$lib/views';
import type { RequestHandler } from './$types';

const page = z.enum(PAGES);
const body = z.discriminatedUnion('op', [
	/** Remember the page's current filter and sort (only kept while the page opens with "last"). */
	z.object({ op: z.literal('last'), page, state: viewState }),
	/** Save the current state as a named view. */
	z.object({ op: z.literal('save'), page, name: z.string().trim().min(1).max(40), state: viewState }),
	z.object({ op: z.literal('delete'), id: z.string().max(64) }),
	/** What the page opens with: "last", "default", or a saved view id. */
	z.object({ op: z.literal('open'), page, value: z.string().max(64) }),
	/** Make this state the page default. */
	z.object({ op: z.literal('default'), page, state: viewState }),
	/** Change layout settings: Today, Habits list, History, hidden features, start page. */
	z.object({
		op: z.literal('patch'),
		today: viewSettings.shape.today.unwrap().partial().optional(),
		habits: viewSettings.shape.habits.unwrap().partial().optional(),
		history: viewSettings.shape.history.unwrap().partial().optional(),
		hidden: viewSettings.shape.hidden.optional(),
		startPage: page.optional()
	}),
	z.object({ op: z.literal('template'), id: z.string().max(32) }),
	/** Put back views from before a template switch (Undo). */
	z.object({ op: z.literal('restore'), views: viewSettings })
]);

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.account) error(401);
	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Not a view change');
	const accountId = locals.account.id;
	const b = parsed.data;
	const v = getViews(accountId);
	let next: ViewSettings = v;
	let previous: ViewSettings | undefined;
	let id: string | undefined;

	switch (b.op) {
		case 'last':
			if ((v.open[b.page] ?? 'last') !== 'last') return json({ ok: true, views: v });
			next = { ...v, last: { ...v.last, [b.page]: b.state } };
			break;
		case 'save':
			id = randomUUID();
			next = { ...v, saved: [...v.saved, savedView.parse({ id, name: b.name, page: b.page, state: b.state })] };
			break;
		case 'delete': {
			const open = { ...v.open };
			for (const p of PAGES) if (open[p] === b.id) delete open[p];
			next = { ...v, open, saved: v.saved.filter((s) => s.id !== b.id) };
			break;
		}
		case 'open':
			if (b.value !== 'last' && b.value !== 'default' && !v.saved.some((s) => s.id === b.value && s.page === b.page))
				error(400, 'No such view');
			next = { ...v, open: { ...v.open, [b.page]: b.value } };
			break;
		case 'default':
			next = { ...v, defaults: { ...v.defaults, [b.page]: b.state } };
			break;
		case 'patch':
			next = {
				...v,
				today: { ...v.today, ...(b.today ?? {}) },
				habits: { ...v.habits, ...(b.habits ?? {}) },
				history: { ...v.history, ...(b.history ?? {}) },
				hidden: b.hidden ?? v.hidden,
				startPage: b.startPage ?? v.startPage
			};
			break;
		case 'template':
			if (!templateById(b.id)) error(400, 'No such template');
			previous = v;
			next = switchTemplate(v, b.id);
			break;
		case 'restore':
			next = b.views;
			break;
	}
	next = viewSettings.parse(next);
	saveViews(accountId, next);
	return json({ ok: true, views: next, id, previous });
};
