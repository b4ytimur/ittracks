import { describe, expect, it } from 'vitest';
import { differs, revOf, type LogContent } from './logrev';

const log = (o: Partial<LogContent> = {}): LogContent => ({
	entries: [{ taskId: 'bench', path: 's1', values: { w: 60, r: 8 } }, { taskId: 'bench', path: 's1', values: { w: 60, r: 7 } }],
	notes: '',
	level: 'target',
	...o
});

describe('the fingerprint of a log', () => {
	it('is the same for the same content, however its values are ordered', () => {
		expect(revOf(log())).toBe(revOf(log()));
		expect(revOf(log({ entries: [{ taskId: 'bench', path: null, values: { a: 1, b: 2 } }] }))).toBe(revOf(log({ entries: [{ taskId: 'bench', path: null, values: { b: 2, a: 1 } }] })));
	});
	it('changes with a value, an order, a note, a level, a place and a type', () => {
		const e = log().entries;
		const all = [
			log(),
			log({ entries: [e[1], e[0]] }),
			log({ entries: [e[0]] }),
			log({ entries: [{ ...e[0], values: { w: 62.5, r: 8 } }, e[1]] }),
			log({ entries: [{ ...e[0], values: { w: '60', r: 8 } }, e[1]] }),
			log({ entries: [{ ...e[0], path: 's2' }, e[1]] }),
			log({ notes: 'x' }),
			log({ level: 'minimum' })
		].map(revOf);
		expect(new Set(all).size).toBe(all.length);
	});
	it('says what differs in words', () => {
		const name = (id: string) => ({ bench: 'Bench press', row: 'Barbell row' })[id] ?? id;
		expect(differs(log(), log(), name)).toEqual([]);
		expect(differs(log(), log({ entries: [], notes: 'tired', level: 'minimum' }), name)).toEqual(['Bench press', 'the note', 'the level']);
		expect(differs(log(), log({ entries: [...log().entries, { taskId: 'row', path: 's2', values: { w: 50 } }] }), name)).toEqual(['Barbell row']);
	});
});
