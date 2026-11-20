// Offline logging: actions taken with no connection wait on this device and are sent
// when it comes back. Each saved action replaces the whole state it touches (a log's
// entries, a status), so sending one twice does no harm.
import { browser } from '$app/environment';

export interface Queued {
	id: string;
	/** Form action URL, such as /log/<id>?/save */
	url: string;
	fields: [string, string][];
	label: string;
	at: number;
}

const KEY = 'ittracks-outbox';

export const outbox = $state<{ items: Queued[]; syncing: boolean }>({ items: [], syncing: false });

function read(): Queued[] {
	try {
		return JSON.parse(localStorage.getItem(KEY) ?? '[]');
	} catch {
		return [];
	}
}

function write(items: Queued[]) {
	outbox.items = items;
	try {
		localStorage.setItem(KEY, JSON.stringify(items));
	} catch {
		/* storage full or blocked: keep it in memory */
	}
}

/** Queue an action. A later save of the same log replaces an earlier one. */
export function enqueue(url: string, fields: [string, string][], label: string) {
	const key = (q: Queued) => q.url + '|' + (q.fields.find(([k]) => k === 'occurrence')?.[1] ?? '');
	const item: Queued = { id: crypto.randomUUID(), url, fields, label, at: Date.now() };
	write([...read().filter((q) => key(q) !== key(item)), item]);
}

/** Send what is waiting. Stops at the first network failure and tries again later. */
export async function flush(): Promise<number> {
	if (!browser || outbox.syncing || !navigator.onLine) return 0;
	const items = read();
	if (!items.length) return 0;
	outbox.syncing = true;
	let sent = 0;
	try {
		for (const q of items) {
			const body = new FormData();
			for (const [k, v] of q.fields) body.append(k, v);
			try {
				await fetch(q.url, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
			} catch {
				break;
			}
			// Delivered (a server refusal won't get better by retrying).
			write(read().filter((x) => x.id !== q.id));
			sent++;
		}
	} finally {
		outbox.syncing = false;
	}
	return sent;
}

/** Start watching the connection. Call once from the app layout. */
export function startOutbox(onSent: (n: number) => void) {
	outbox.items = read();
	const go = () => flush().then((n) => n && onSent(n));
	window.addEventListener('online', go);
	const t = setInterval(go, 30_000);
	go();
	return () => {
		window.removeEventListener('online', go);
		clearInterval(t);
	};
}

/** Is this error what fetch throws when there is no connection? */
export const isOffline = (e: unknown) => !navigator.onLine || e instanceof TypeError;
