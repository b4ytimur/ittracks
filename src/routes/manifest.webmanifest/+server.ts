// The web app manifest, with home screen shortcuts (long-press the app icon) for the
// habits the user pinned. Served with the session cookie (crossorigin="use-credentials").
import { json } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { habit } from '$lib/server/db/schema';
import { getSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

const icon = [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }];

export const GET: RequestHandler = ({ locals }) => {
	const shortcuts: { name: string; short_name?: string; url: string; icons: typeof icon }[] = [
		{ name: 'Today', url: '/', icons: icon }
	];
	if (locals.account) {
		const pinned = getSettings(locals.account.id).pinned;
		const rows = pinned.length
			? db
					.select({ id: habit.id, name: habit.name })
					.from(habit)
					.where(and(eq(habit.accountId, locals.account.id), inArray(habit.id, pinned), eq(habit.archived, false)))
					.all()
			: [];
		for (const id of pinned) {
			const h = rows.find((r) => r.id === id);
			if (h) shortcuts.push({ name: `Log ${h.name}`, short_name: h.name.slice(0, 12), url: `/q/${h.id}`, icons: icon });
		}
	}
	return json(
		{
			name: 'ittracks',
			short_name: 'ittracks',
			description: 'A fully customizable habit tracker.',
			start_url: '/',
			scope: '/',
			display: 'standalone',
			background_color: '#fafaf9',
			theme_color: '#2563eb',
			icons: [
				{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
				{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
				{ src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
				{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }
			],
			shortcuts: shortcuts.slice(0, 5)
		},
		{ headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' } }
	);
};
