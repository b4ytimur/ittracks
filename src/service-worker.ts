/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// Caches the app's built files so it starts fast and installs as an app, and keeps a copy
// of the pages you open so Today and your logs still open with no signal. Pages always
// come from the server first; the copy is only used when the network fails.
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `ittracks-${version}`;
const PAGES = 'ittracks-pages';
const ASSETS = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== PAGES).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

/** Pages and their data that are worth keeping a copy of for offline use. */
const keepsCopy = (url: URL) =>
	url.pathname === '/' ||
	url.pathname === '/__data.json' ||
	url.pathname.startsWith('/log/') ||
	url.pathname.startsWith('/q/') ||
	url.pathname.startsWith('/habits') ||
	url.pathname.startsWith('/history');

sw.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (url.origin !== sw.location.origin) return;
	if (url.pathname === '/logout' || url.pathname === '/login') {
		// Signing out (or in as someone else) forgets the saved pages.
		event.waitUntil(caches.delete(PAGES));
		return;
	}
	if (event.request.method !== 'GET') return;
	if (ASSETS.includes(url.pathname)) {
		event.respondWith(caches.match(url.pathname).then((hit) => hit ?? fetch(event.request)));
		return;
	}
	if (!keepsCopy(url)) return;
	event.respondWith(
		fetch(event.request)
			.then((res) => {
				if (res.ok && res.type === 'basic') {
					const copy = res.clone();
					caches.open(PAGES).then((c) => c.put(event.request, copy));
				}
				return res;
			})
			.catch(async () => {
				const hit = await caches.open(PAGES).then((c) => c.match(event.request));
				if (hit) return hit;
				// A page never opened before: fall back to Today if we have it.
				if (event.request.mode === 'navigate') {
					const today = await caches.open(PAGES).then((c) => c.match('/'));
					if (today) return today;
				}
				return Response.error();
			})
	);
});

// Reminders pushed by the server at a Habit's cue time.
sw.addEventListener('push', (event) => {
	let msg = {
		title: 'ittracks',
		body: '',
		url: '/',
		tag: undefined as string | undefined,
		occurrenceId: undefined as string | undefined,
		actions: [] as { action: string; title: string }[]
	};
	try {
		msg = { ...msg, ...(event.data?.json() ?? {}) };
	} catch {
		msg.body = event.data?.text() ?? '';
	}
	event.waitUntil(
		sw.registration.showNotification(msg.title, {
			body: msg.body,
			tag: msg.tag,
			icon: '/icon-192.png',
			badge: '/icon-192.png',
			data: { url: msg.url, occurrenceId: msg.occurrenceId },
			// Buttons: Done, Minimum, Snooze. Not every platform shows them.
			...(msg.occurrenceId && msg.actions.length ? { actions: msg.actions } : {})
		} as NotificationOptions)
	);
});

function openApp(url: string) {
	return sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
		const open = windows.find((w) => new URL(w.url).origin === sw.location.origin);
		if (open) return open.focus().then((w) => w.navigate(url));
		return sw.clients.openWindow(url);
	});
}

sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const data = (event.notification.data ?? {}) as { url?: string; occurrenceId?: string };
	const url = data.url ?? '/';
	if (event.action && data.occurrenceId) {
		// Act without opening the app; open it only if that fails.
		event.waitUntil(
			fetch(`/api/occurrence/${data.occurrenceId}`, {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: event.action })
			})
				.then(async (res) => {
					if (res.ok) return;
					// The server may name a better page, such as the quick log for a required field.
					const body = (await res.json().catch(() => null)) as { open?: string } | null;
					return openApp(body?.open ?? url);
				})
				.catch(() => openApp(url))
		);
		return;
	}
	event.waitUntil(openApp(url));
});
