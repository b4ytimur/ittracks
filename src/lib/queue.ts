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
	/** Refused because what it saves changed elsewhere: it can be kept over that. */
	stale?: boolean;
}

/** Saved, refused (sending it again won't help), or not answered yet (it will be sent again). */
export type Answer = { kind: 'saved' } | { kind: 'refused'; why: string; to?: string; stale?: unknown } | { kind: 'later' };

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
	if (r.type === 'failure')
		return { kind: 'refused', why: String(r.data?.error ?? 'The server did not accept it.'), ...(r.data?.stale ? { stale: r.data.stale } : {}) };
	if (r.type === 'error' && FINAL.includes(res.status))
		return { kind: 'refused', why: res.status === 404 ? 'It is no longer there.' : 'The server did not accept it.' };
	return { kind: 'later' };
}

const field = (fields: [string, string][], k: string) => fields.find(([f]) => f === k)?.[1];
/**
 * Two actions with the same key replace each other: the same action on the same log, or on the
 * same habit for actions that name a habit (a past day), or on the same date for the day note.
 * An action that names a Slot (a swap, Pick another) replaces only itself on that Slot, so a swap
 * of another Slot in the same log is kept.
 */
export const keyOf = (q: Pick<Queued, 'url' | 'fields'>) => {
	const slot = field(q.fields, 'slot');
	return q.url + '|' + (field(q.fields, 'occurrence') ?? field(q.fields, 'habit') ?? field(q.fields, 'date') ?? '') + (slot === undefined ? '' : `|${slot}`);
};

/**
 * What waits from earlier on the same page, apart from older copies of this one: it is sent first,
 * so the server gets them in the order they were made (a swap before the log's save that follows).
 * What was refused waits for someone to look at it, and holds nothing up.
 */
export const ahead = (items: Queued[], q: Pick<Queued, 'url' | 'fields'>) =>
	items.filter((x) => !x.refused && x.url.split('?')[0] === q.url.split('?')[0] && keyOf(x) !== keyOf(q)).map((x) => x.id);

/** The same save, not held back by what changed elsewhere since: the payload without the versions it grew from. */
export function overriding(fields: [string, string][]): [string, string][] {
	return fields.map(([k, v]) => {
		if (k !== 'payload') return [k, v];
		const { bases: _, ...rest } = JSON.parse(v);
		return [k, JSON.stringify(rest)];
	});
}

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
		const no = a.kind === 'refused' ? { refused: a.why, ...(a.stale ? { stale: true } : {}) } : null;
		store.write(no ? store.read().map((x) => (x.id === q.id ? { ...x, ...no } : x)) : store.read().filter((x) => x.id !== q.id));
		if (!no) sent++;
	}
	return sent;
}
