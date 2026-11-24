// What waits to be sent, and what the server's answer to a save means. No runes and no browser
// here, so it can be tested; outbox.svelte.ts keeps it on this device and watches the connection.
import { deserialize } from '$app/forms';

export interface Queued {
	id: string;
	/** Form action URL, such as /log/<id>?/save */
	url: string;
	fields: [string, string][];
	label: string;
	at: number;
	/** Why the server said no. It stays here until someone tries again or discards it. */
	refused?: string;
}

/** Saved, refused (sending it again won't help), or not answered yet (it will be sent again). */
export type Answer = { kind: 'saved' } | { kind: 'refused'; why: string; to?: string } | { kind: 'later' };

/** Answers that stay the same however often it is sent. */
const FINAL = [400, 404, 405, 410, 413, 422];

/**
 * Read a form action's answer. The status alone says nothing: a refused action answers 200 with
 * the refusal inside, and a proxy or a hotel's sign-in page answers 200 with a page of its own.
 */
export async function readAnswer(res: Response): Promise<Answer> {
	let r: ReturnType<typeof deserialize>;
	try {
		r = deserialize(await res.text());
	} catch {
		return { kind: 'later' };
	}
	if (r.type === 'success') return { kind: 'saved' };
	if (r.type === 'redirect') {
		// Signed out: it is sent again after signing in.
		if (/^\/(login|setup)(\?|$)/.test(r.location)) return { kind: 'later' };
		// Sent on to the log because a required field is empty: nothing was logged.
		if (r.location.startsWith('/log/')) return { kind: 'refused', why: 'It needs something filled in first.', to: r.location };
		return { kind: 'saved' };
	}
	if (r.type === 'failure') return { kind: 'refused', why: String(r.data?.error ?? 'The server did not accept it.') };
	if (r.type === 'error' && FINAL.includes(res.status))
		return { kind: 'refused', why: res.status === 404 ? 'It is no longer there.' : 'The server did not accept it.' };
	return { kind: 'later' };
}

const field = (fields: [string, string][], k: string) => fields.find(([f]) => f === k)?.[1];
/**
 * Two actions with the same key replace each other: the same action on the same log, or on the
 * same habit for actions that name a habit (a past day), or on the same date for the day note.
 */
export const keyOf = (q: Pick<Queued, 'url' | 'fields'>) =>
	q.url + '|' + (field(q.fields, 'occurrence') ?? field(q.fields, 'habit') ?? field(q.fields, 'date') ?? '');

export interface Store {
	read(): Queued[];
	write(items: Queued[]): void;
}

/**
 * Send what is waiting and say how many went. Only a saved one leaves: one that is refused stays
 * with the reason, one that got no answer stays for the next time. Stops where there is no
 * connection. `skip` leaves out what a page is saving itself right now.
 */
export async function sendAll(store: Store, post: (q: Queued) => Promise<Response>, skip: (q: Queued) => boolean = () => false): Promise<number> {
	let sent = 0;
	for (const q of store.read()) {
		// Replaced or sent by a page since this round began.
		if (q.refused || skip(q) || !store.read().some((x) => x.id === q.id)) continue;
		let a: Answer;
		try {
			a = await readAnswer(await post(q));
		} catch {
			break;
		}
		if (a.kind === 'later') continue;
		const why = a.kind === 'refused' ? a.why : null;
		store.write(why === null ? store.read().filter((x) => x.id !== q.id) : store.read().map((x) => (x.id === q.id ? { ...x, refused: why } : x)));
		if (why === null) sent++;
	}
	return sent;
}
