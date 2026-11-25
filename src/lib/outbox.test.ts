import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ deserialize: (text: string) => JSON.parse(text) }));

import { discard, enqueue, outbox, retry, save } from './outbox.svelte';

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const saved = () => answer(200, { type: 'success', status: 200 });
const crashed = () => answer(500, { type: 'error', error: { message: 'Internal Error' } });
const refused = () => answer(200, { type: 'failure', status: 400, data: { error: 'Too far back.' } });
const payloads = () => outbox.items.map((q) => q.fields[0][1]);
const put = (v: string) => save('/log/1?/save', [['payload', v]], 'Gym');

describe('saving', () => {
	let disk: Record<string, string>;
	beforeEach(() => {
		disk = {};
		outbox.items = [];
		vi.stubGlobal('localStorage', { getItem: (k: string) => disk[k] ?? null, setItem: (k: string, v: string) => void (disk[k] = v) });
	});

	it('waits here unless it was saved or refused', async () => {
		vi.stubGlobal('fetch', async () => crashed());
		expect(await put('a')).toEqual({ kind: 'later' });
		expect(payloads()).toEqual(['a']);
		vi.stubGlobal('fetch', async () => {
			throw new TypeError('Failed to fetch');
		});
		expect(await put('b')).toEqual({ kind: 'later' });
		expect(payloads()).toEqual(['b']);
	});
	it('a refused save is not called saved, and keeps what waits', async () => {
		enqueue('/log/1?/save', [['payload', 'older']], 'Gym');
		vi.stubGlobal('fetch', async () => refused());
		expect(await put('b')).toEqual({ kind: 'refused', why: 'Too far back.' });
		expect(payloads()).toEqual(['older']);
	});
	it('once it is saved, an older one of the same log goes, so it never overwrites it', async () => {
		enqueue('/log/1?/save', [['payload', 'older']], 'Gym');
		enqueue('/log/2?/save', [['payload', 'another log']], 'Run');
		vi.stubGlobal('fetch', async () => saved());
		expect(await put('newer')).toEqual({ kind: 'saved' });
		expect(payloads()).toEqual(['another log']);
	});
	it('an older save that fails late does not replace a newer one, nor a Finish', async () => {
		let fail!: () => void;
		vi.stubGlobal('fetch', () => new Promise<Response>((ok) => (fail = () => ok(crashed()))));
		const slow = put('older');
		enqueue('/log/1?/save', [['payload', 'finish']], 'Gym');
		fail();
		await slow;
		expect(payloads()).toEqual(['finish']);

		outbox.items = [];
		disk = {};
		const first = put('first');
		const failFirst = fail;
		vi.stubGlobal('fetch', async () => saved());
		await put('second');
		failFirst();
		await first;
		expect(payloads()).toEqual([]);
	});
	it('keeps more than one in memory when storage is full', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => null,
			setItem: () => {
				throw new Error('QuotaExceededError');
			}
		});
		enqueue('/log/1?/save', [['payload', 'a']], 'Gym');
		enqueue('/log/2?/save', [['payload', 'b']], 'Run');
		expect(payloads()).toEqual(['a', 'b']);
	});
	it('a discarded change can be taken back, a refused one tried again', async () => {
		enqueue('/log/1?/save', [['payload', 'a']], 'Gym');
		const id = outbox.items[0].id;
		const undo = discard(id);
		expect(payloads()).toEqual([]);
		undo();
		expect(payloads()).toEqual(['a']);
		outbox.items = [{ ...outbox.items[0], refused: 'Too far back.' }];
		disk['ittracks-outbox'] = JSON.stringify(outbox.items);
		await retry(id);
		expect(outbox.items[0].refused).toBeUndefined();
	});
});
