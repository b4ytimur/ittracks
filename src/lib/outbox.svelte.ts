// Offline logging: actions taken with no connection wait on this device and are sent
// when it comes back. Each saved action replaces the whole state it touches (a log's
// entries, a status), so sending one twice does no harm. What an answer means is in queue.ts.
import { untrack } from 'svelte';
import { browser } from '$app/environment';
import { keyOf, overriding, readAnswer, sendAll, type Answer, type Queued } from './queue';

export type { Queued } from './queue';

const SHARED = 'ittracks-outbox';
/** Whose saves these are: another person signing in here never sends them as theirs. */
let KEY = SHARED;

export const outbox = $state<{ items: Queued[]; syncing: boolean }>({ items: [], syncing: false });

/** Storage is full or blocked: what waits is only in memory. */
let memoryOnly = false;

function read(): Queued[] {
	if (memoryOnly) return $state.snapshot(outbox.items) as Queued[];
	try {
		return JSON.parse(localStorage.getItem(KEY) ?? '[]');
	} catch {
		return $state.snapshot(outbox.items) as Queued[];
	}
}

function write(items: Queued[]) {
	outbox.items = items;
	try {
		localStorage.setItem(KEY, JSON.stringify(items));
		memoryOnly = false;
	} catch {
		memoryOnly = true;
	}
}

/** The newest save of each thing that a page is sending right now. */
const sending = new Map<string, number>();
let saves = 0;

/** Queue an action. A later save of the same log replaces an earlier one, also one still on its way. */
export function enqueue(url: string, fields: [string, string][], label: string) {
	const item: Queued = { id: crypto.randomUUID(), url, fields, label, at: Date.now() };
	sending.delete(keyOf(item));
	write([...read().filter((q) => keyOf(q) !== keyOf(item)), item]);
}

function post(q: Pick<Queued, 'url' | 'fields'>) {
	const body = new FormData();
	for (const [k, v] of q.fields) body.append(k, v);
	return fetch(q.url, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
}

/**
 * Save now and say what became of it. What gets no answer waits here and is sent again. A save
 * holds everything an earlier one of the same thing did, so once it is saved that one goes.
 */
export async function save(url: string, fields: [string, string][], label: string): Promise<Answer> {
	const key = keyOf({ url, fields });
	const mine = ++saves;
	sending.set(key, mine);
	let a: Answer;
	try {
		a = await readAnswer(await post({ url, fields }));
	} catch {
		a = { kind: 'later' };
	}
	// A newer save of the same thing has started since: what happened to this one no longer matters.
	if (sending.get(key) !== mine) return a;
	sending.delete(key);
	if (a.kind === 'later') enqueue(url, fields, label);
	else if (a.kind === 'saved' && read().some((q) => keyOf(q) === key)) write(read().filter((q) => keyOf(q) !== key));
	return a;
}

/** Send what is waiting. Stops at the first network failure and tries again later. */
export async function flush(): Promise<number> {
	if (!browser || outbox.syncing || !navigator.onLine || !read().length) return 0;
	outbox.syncing = true;
	try {
		return await sendAll({ read, write }, post, (q) => sending.has(keyOf(q)));
	} finally {
		outbox.syncing = false;
	}
}

/**
 * Send a refused action again, for instance after changing what it was refused for. One refused
 * because it changed elsewhere is kept over that: asking again would be refused again.
 */
export function retry(id: string) {
	write(read().map((x) => {
		if (x.id !== id) return x;
		const { refused: _, stale, ...q } = x;
		return stale ? { ...q, fields: overriding(q.fields) } : q;
	}));
	return flush();
}

/** Give up on an action, and how to take that back. */
export function discard(id: string): () => void {
	const q = read().find((x) => x.id === id);
	write(read().filter((x) => x.id !== id));
	return () => {
		if (q) write([...read().filter((x) => keyOf(x) !== keyOf(q)), q]);
	};
}

/** What waits from now on is this account's. What was kept before there was one per account is taken over. */
export function openOutbox(accountId: string) {
	const key = `${SHARED}:${accountId}`;
	if (KEY !== SHARED && KEY !== key) {
		memoryOnly = false;
		outbox.items = [];
	}
	KEY = key;
	try {
		const before: Queued[] = JSON.parse(localStorage.getItem(SHARED) ?? '[]');
		localStorage.removeItem(SHARED);
		if (before.length) write([...before.filter((b) => !read().some((q) => keyOf(q) === keyOf(b))), ...read()]);
	} catch {
		// No storage here: what waits is in memory.
	}
	outbox.items = read();
}

/** Start watching the connection. Call once from the app layout. */
export function startOutbox(accountId: string, onSent: (n: number) => void) {
	// Untracked: an effect that calls this would otherwise run again after every round, and with
	// something still waiting that is a round without pause.
	const go = () => untrack(() => flush().then((n) => n && onSent(n)));
	untrack(() => openOutbox(accountId));
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
