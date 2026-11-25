import { error, json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getSettings, getViews, saveViews } from '$lib/server/settings';
import { checkViews } from '$lib/rules/views';
import {
	DEFAULT_VIEW,
	PAGES,
	initialView,
	recordDefault,
	recordPatch,
	savedView,
	switchTemplate,
	templateById,
	viewSettings,
	viewState,
	viewStateOf,
	type ViewSettings
} from '$lib/views';
import type { RequestHandler } from './$types';

const page = z.enum(PAGES);
const body = z.discriminatedUnion('op', [
	/** Change a view's filter, sort and grouping: the view named, else the one the page is on ("default" is the page default). */
	z.object({ op: z.literal('update'), page, view: z.string().max(64).optional(), state: viewState }),
	/** Put the page on one of its views. */
	z.object({ op: z.literal('select'), page, view: z.string().max(64) }),
	/** A new named view with this state; the page is on it after. */
	z.object({ op: z.literal('save'), page, name: z.string().trim().min(1).max(40), state: viewState }),
	z.object({ op: z.literal('delete'), id: z.string().max(64) }),
	/** What the page opens with: "last", "default", or a saved view id. */
	z.object({ op: z.literal('open'), page, value: z.string().max(64) }),
	/** Change layout settings: Today, Habits list, History, hidden features, start page. */
	z.object({
		op: z.literal('patch'),
		today: viewSettings.shape.today.unwrap().partial().optional(),
		habits: viewSettings.shape.habits.unwrap().partial().optional(),
		history: viewSettings.shape.history.unwrap().partial().optional(),
		hidden: viewSettings.shape.hidden.optional(),
		startPage: page.optional()
	}),
	/** Switch view template. `keep` (the default) keeps the settings you changed on top of the old one. */
	z.object({ op: z.literal('template'), id: z.string().max(32), keep: z.boolean().default(true) }),
	/** Put back views from before a template switch (Undo). */
	z.object({ op: z.literal('restore'), views: viewSettings })
]);

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.account) error(401);
	const raw = await request.json().catch(() => null);
	const parsed = body.safeParse(raw);
	if (!parsed.success) error(400, 'Not a view change');
	const accountId = locals.account.id;
	const b = parsed.data;
	const v = getViews(accountId);
	let next: ViewSettings = v;
	let previous: ViewSettings | undefined;
	let id: string | undefined;

	switch (b.op) {
		case 'update': {
			const target = b.view ?? v.active[b.page] ?? initialView(v, b.page);
			if (target === DEFAULT_VIEW) next = { ...v, defaults: { ...v.defaults, [b.page]: b.state }, own: recordDefault(v, b.page, b.state) };
			// Deleted while the change was on its way: nothing left to change.
			else if (!viewStateOf(v, b.page, target)) return json({ ok: true, views: v });
			else next = { ...v, saved: v.saved.map((s) => (s.id === target ? { ...s, state: b.state } : s)) };
			break;
		}
		case 'select':
			if (!viewStateOf(v, b.page, b.view)) error(400, 'No such view');
			next = { ...v, active: { ...v.active, [b.page]: b.view } };
			break;
		case 'save':
			id = randomUUID();
			next = {
				...v,
				saved: [...v.saved, savedView.parse({ id, name: b.name, page: b.page, state: b.state })],
				active: { ...v.active, [b.page]: id }
			};
			break;
		case 'delete': {
			const open = { ...v.open };
			const active = { ...v.active };
			for (const p of PAGES) {
				if (open[p] === b.id) delete open[p];
				if (active[p] === b.id) delete active[p];
			}
			next = { ...v, open, active, saved: v.saved.filter((s) => s.id !== b.id) };
			break;
		}
		case 'open':
			if (b.value !== 'last' && b.value !== 'default' && !v.saved.some((s) => s.id === b.value && s.page === b.page))
				error(400, 'No such view');
			next = { ...v, open: { ...v.open, [b.page]: b.value } };
			break;
		case 'patch': {
			// Zod fills defaults for keys that weren't sent; only apply what the request named.
			const sent = (group: string, parsedGroup: Record<string, unknown> | undefined) =>
				Object.fromEntries(Object.keys(raw?.[group] ?? {}).filter((k) => parsedGroup && k in parsedGroup).map((k) => [k, parsedGroup![k]]));
			const patch = {
				today: sent('today', b.today),
				habits: sent('habits', b.habits),
				history: sent('history', b.history),
				hidden: raw && 'hidden' in raw && b.hidden ? b.hidden : undefined
			};
			next = {
				...v,
				today: { ...v.today, ...patch.today },
				habits: { ...v.habits, ...patch.habits },
				history: { ...v.history, ...patch.history },
				hidden: patch.hidden ?? v.hidden,
				startPage: b.startPage ?? v.startPage,
				// What you change by hand is yours, and stays when you switch template.
				own: recordPatch(v, patch)
			};
			break;
		}
		case 'template':
			if (!templateById(b.id)) error(400, 'No such template');
			previous = v;
			next = switchTemplate(v, b.id, { keep: b.keep });
			break;
		case 'restore':
			next = b.views;
			break;
	}
	next = viewSettings.parse(next);
	const issues = checkViews(next, { ranges: getSettings(accountId).ranges.length });
	const block = issues.find((i) => i.severity === 'block');
	if (block) error(400, block.reason);
	saveViews(accountId, next);
	return json({ ok: true, views: next, id, previous, warnings: issues.map((i) => i.reason) });
};
