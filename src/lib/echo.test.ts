import { describe, expect, it } from 'vitest';
import { canUndo, dropEntry, inSentence, oneStop, pushEntry, setHeld, undoShows, type Entry } from './echo';

const e = (id: number, o: Partial<Entry> = {}): Entry => ({ id, text: `change ${id}`, ...o });

describe('the band', () => {
	it('keeps the last ten, newest first', () => {
		const all = Array.from({ length: 12 }, (_, i) => e(i)).reduce(pushEntry, [] as Entry[]);
		expect(all.map((x) => x.id)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
	});
	it('offers no Undo while the row shows its own', () => {
		const one = [e(1, { undo: () => {} })];
		expect(canUndo(one[0])).toBe(true);
		expect(canUndo(setHeld(one, 1, true)[0])).toBe(false);
		expect(canUndo(setHeld(setHeld(one, 1, true), 1, false)[0])).toBe(true);
	});
	it('shows the way back of what its newest entry is about, and only that', () => {
		const about = e(1, { subject: 'a', undo: () => {} });
		expect(undoShows([about], 'a')).toBe(true);
		expect(undoShows([about], 'b')).toBe(false);
		expect(undoShows([], 'a')).toBe(false);
		// Held for the row, or with something newer on the line: the row keeps its own.
		expect(undoShows([e(1, { ...about, held: true })], 'a')).toBe(false);
		expect(undoShows([e(2), about], 'a')).toBe(false);
	});
	it('drops one and leaves the rest', () => {
		expect(dropEntry([e(2), e(1)], 2).map((x) => x.id)).toEqual([1]);
	});
});

// An identity is a sentence, so a line that quotes or names one would end it twice.
describe('one full stop', () => {
	it('drops the line’s stop after a quoted sentence that has its own', () => {
		expect(oneStop('Changed “I protect my focus.”.')).toBe('Changed “I protect my focus.”');
		expect(oneStop('Deleted “I run.”. Its habits stay.')).toBe('Deleted “I run.” Its habits stay.');
		expect(oneStop('Archived Read a page.. Its logs are kept.')).toBe('Archived Read a page. Its logs are kept.');
		expect(oneStop('Added “Am I a runner?”.')).toBe('Added “Am I a runner?”');
	});
	it('leaves a line with one stop, an ellipsis and numbers as they are', () => {
		for (const t of ['Changed “I run”.', 'Logged Read.', 'Wait...', 'Logged 2.5 km.', 'Renamed to “v1.2”.']) expect(oneStop(t)).toBe(t);
	});
	it('takes a name’s own stop off inside a sentence, but not an ellipsis', () => {
		expect(`Moved ${inSentence('I am someone who trains.')} to 2 of 4.`).toBe('Moved I am someone who trains to 2 of 4.');
		expect(inSentence('Bench press')).toBe('Bench press');
		expect(inSentence('And then...')).toBe('And then...');
	});
});
