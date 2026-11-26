import { beforeEach, describe, expect, it, vi } from 'vitest';

// $app/forms needs the client's decoders; the answers here only carry plain errors.
vi.mock('$app/forms', () => ({
	deserialize: (text: string) => {
		const r = JSON.parse(text);
		return typeof r.data === 'string' ? { ...r, data: { error: JSON.parse(r.data)[1] } } : r;
	}
}));

import { ahead, keyOf, readAnswer, sendAll, type Queued } from './queue';

// As the running app answers them (SvelteKit 2): a refusal and a redirect are 200.
const res = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const saved = () => res(200, { type: 'success', status: 200, data: '[{"saved":1},true]' });
const refused = () => res(200, { type: 'failure', status: 400, data: '[{"error":1},"Could not read the log."]' });
const crashed = () => res(500, { type: 'error', error: { message: 'Internal Error' } });
const signedOut = () => res(401, { type: 'error', error: { message: 'Sign in first' } });
const gone = () => res(404, { type: 'error', error: { message: 'Error: 404' } });
const page = () => res(200, '<!doctype html><title>Hotel Wi-Fi</title>');
const to = (location: string) => res(200, { type: 'redirect', status: 303, location });

describe('what an answer means', () => {
	it('saved only on success, or on a redirect that says so', async () => {
		expect(await readAnswer(saved())).toEqual({ kind: 'saved' });
		expect(await readAnswer(to('/?did=1'))).toEqual({ kind: 'saved' });
	});
	it('a refusal is refused, though it answers 200, with its reason', async () => {
		expect(await readAnswer(refused())).toEqual({ kind: 'refused', why: 'Could not read the log.' });
		expect(await readAnswer(gone())).toEqual({ kind: 'refused', why: 'It is no longer there.' });
		expect(await readAnswer(to('/log/1?quick'))).toMatchObject({ kind: 'refused', to: '/log/1?quick' });
	});
	it('anything else is not saved yet', async () => {
		for (const r of [crashed(), signedOut(), page(), to('/login'), to('/setup'), res(502, 'Bad gateway'), res(200, '')])
			expect(await readAnswer(r)).toEqual({ kind: 'later' });
	});
});

describe('sending what waits', () => {
	const item = (id: string): Queued => ({ id, url: `/log/${id}?/save`, fields: [['payload', id]], label: id, at: 0 });
	let items: Queued[];
	const store = { read: () => items, write: (x: Queued[]) => void (items = x) };
	const ids = () => items.map((q) => q.id);
	beforeEach(() => {
		items = ['a', 'b', 'c'].map(item);
	});
	const answers = (by: Record<string, () => Response>) => async (q: Queued) => by[q.id]();

	it('only what was saved leaves', async () => {
		expect(await sendAll(store, answers({ a: saved, b: crashed, c: saved }))).toBe(2);
		expect(ids()).toEqual(['b']);
	});
	it('a lost session, a server error or a hotel page loses nothing', async () => {
		expect(await sendAll(store, answers({ a: signedOut, b: crashed, c: page }))).toBe(0);
		expect(ids()).toEqual(['a', 'b', 'c']);
		expect(items.some((q) => q.refused)).toBe(false);
	});
	it('what is refused stays with the reason and is not sent again by itself', async () => {
		await sendAll(store, answers({ a: refused, b: saved, c: saved }));
		expect(items).toMatchObject([{ id: 'a', refused: 'Could not read the log.' }]);
		const post = vi.fn(answers({ a: saved }));
		expect(await sendAll(store, post)).toBe(0);
		expect(post).not.toHaveBeenCalled();
	});
	it('stops with no connection and keeps the rest', async () => {
		const post = vi.fn(async (q: Queued) => {
			if (q.id === 'b') throw new TypeError('Failed to fetch');
			return saved();
		});
		expect(await sendAll(store, post)).toBe(1);
		expect(ids()).toEqual(['b', 'c']);
		expect(post).toHaveBeenCalledTimes(2);
	});
	it('keeps what was queued meanwhile, and leaves out what a page is saving', async () => {
		const post = vi.fn(async (q: Queued) => {
			if (q.id === 'a') items = [...items.filter((x) => x.id !== 'b'), item('new')]; // b was replaced by a newer save
			return saved();
		});
		expect(await sendAll(store, post, (q) => q.id === 'c')).toBe(1);
		expect(ids()).toEqual(['c', 'new']);
		expect(post).toHaveBeenCalledTimes(1);
	});
	it('the same action on the same thing replaces itself', () => {
		expect(keyOf({ url: '/?/done', fields: [['occurrence', '1']] })).toBe(keyOf({ url: '/?/done', fields: [['level', 'x'], ['occurrence', '1']] }));
		expect(keyOf({ url: '/?/done', fields: [['occurrence', '1']] })).not.toBe(keyOf({ url: '/?/done', fields: [['occurrence', '2']] }));
	});
	it('a swap replaces only a swap of the same Slot; what names no Slot keeps its key', () => {
		const swap = (slot: string, task: string) => keyOf({ url: '/log/1?/swap', fields: [['slot', slot], ['task', task]] });
		expect(swap('a', 'incline')).toBe(swap('a', 'dumbbell'));
		expect(swap('a', 'incline')).not.toBe(swap('b', 'incline'));
		expect(keyOf({ url: '/log/1?/reroll', fields: [['slot', 'a']] })).not.toBe(keyOf({ url: '/log/1?/reroll', fields: [['slot', 'b']] }));
		expect(keyOf({ url: '/?/done', fields: [['occurrence', '1']] })).toBe('/?/done|1');
		expect(keyOf({ url: '/log/1?/save', fields: [['payload', '{}']] })).toBe('/log/1?/save|');
		expect(keyOf({ url: '/journal?/dayNote', fields: [['date', '2026-11-26'], ['text', 'x']] })).toBe('/journal?/dayNote|2026-11-26');
	});
	it('what waits from earlier on the same page goes first, but not an older copy of this one, nor a refused one', () => {
		const q = (id: string, url: string, fields: [string, string][] = [], refused?: string): Queued => ({ id, url, fields, label: 'Gym', at: 0, ...(refused ? { refused } : {}) });
		const waiting = [
			q('save', '/log/1?/save', [['payload', 'older']]),
			q('swap', '/log/1?/swap', [['slot', 'a'], ['task', 't']]),
			q('gone', '/log/1?/swap', [['slot', 'b'], ['task', 't']], 'It is no longer there.'),
			q('other log', '/log/2?/swap', [['slot', 'a'], ['task', 't']]),
			q('today', '/?/done', [['occurrence', '1']])
		];
		expect(ahead(waiting, { url: '/log/1?/save', fields: [['payload', 'newer']] })).toEqual(['swap']);
		expect(ahead(waiting, { url: '/log/1?/swap', fields: [['slot', 'c'], ['task', 't']] })).toEqual(['save', 'swap']);
		expect(ahead(waiting, { url: '/log/1?/swap', fields: [['slot', 'a'], ['task', 'u']] })).toEqual(['save']);
		expect(ahead(waiting, { url: '/log/3?/save', fields: [] })).toEqual([]);
	});
});
