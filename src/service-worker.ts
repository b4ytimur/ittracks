/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// Caches the app's built files so it starts fast and installs as an app.
// Pages and data always come from the server, since they are per-user.
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `ittracks-${version}`;
const ASSETS = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (event.request.method !== 'GET' || url.origin !== sw.location.origin) return;
	if (ASSETS.includes(url.pathname)) {
		event.respondWith(caches.match(url.pathname).then((hit) => hit ?? fetch(event.request)));
	}
});

// Reminders pushed by the server at a Habit's cue time.
sw.addEventListener('push', (event) => {
	let msg = { title: 'ittracks', body: '', url: '/', tag: undefined as string | undefined };
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
			data: { url: msg.url }
		})
	);
});

sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = (event.notification.data?.url as string | undefined) ?? '/';
	event.waitUntil(
		sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
			const open = windows.find((w) => new URL(w.url).origin === sw.location.origin);
			if (open) return open.focus().then((w) => w.navigate(url));
			return sw.clients.openWindow(url);
		})
	);
});
