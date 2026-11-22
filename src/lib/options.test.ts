import { describe, expect, it } from 'vitest';
import { activeOptions, findOption, keepEarlierScores, mergeOptions, optionName, repeatedName, scoresOn, type ChoiceOption } from './options';

const opts: ChoiceOption[] = [
	{ id: 'a', name: 'Great' },
	{ id: 'b', name: 'Okay' },
	{ id: 'c', name: 'Bad', archived: true }
];

describe('options with stable ids', () => {
	it('a stored id reads as its name, archived options included', () => {
		expect(optionName(opts, 'b')).toBe('Okay');
		expect(optionName(opts, 'c')).toBe('Bad');
		expect(optionName(opts, 'gone')).toBeNull();
		expect(optionName(null, 'a')).toBeNull();
		expect(activeOptions(opts).map((o) => o.id)).toEqual(['a', 'b']);
	});

	it('a value given by id or by name finds an option new logs offer', () => {
		expect(findOption(opts, 'a')?.name).toBe('Great');
		expect(findOption(opts, '  okay ')?.id).toBe('b');
		// Archived options take no new logs.
		expect(findOption(opts, 'Bad')).toBeNull();
		expect(findOption(opts, 'c')).toBeNull();
		expect(findOption(opts, '')).toBeNull();
	});

	it('two options with one name are caught', () => {
		expect(repeatedName([{ name: 'Good' }, { name: ' good ' }])).toBe(' good ');
		expect(repeatedName([{ name: 'Good' }, { name: 'Bad' }])).toBeNull();
	});

	it('saving keeps the edited order, archives removed options logs used, drops the rest', () => {
		const saved: ChoiceOption[] = [...opts, { id: 'd', name: 'Meh' }];
		const merged = mergeOptions(saved, [{ id: 'b', name: 'Fine' }, { id: 'e', name: 'New' }], ['a']);
		expect(merged).toEqual([
			{ id: 'b', name: 'Fine' },
			{ id: 'e', name: 'New' },
			{ id: 'a', name: 'Great', archived: true },
			{ id: 'c', name: 'Bad', archived: true }
		]);
	});
});

describe('numbers per option, versioned', () => {
	const earlier = [
		{ until: '2026-10-31', scores: { a: 1 } },
		{ until: '2026-11-15', scores: { a: 2 } }
	];

	it('a day reads the numbers in force then', () => {
		expect(scoresOn({ a: 3 }, earlier, '2026-10-01').a).toBe(1);
		expect(scoresOn({ a: 3 }, earlier, '2026-11-15').a).toBe(2);
		expect(scoresOn({ a: 3 }, earlier, '2026-11-16').a).toBe(3);
		expect(scoresOn(null, null, '2026-11-16')).toEqual({});
	});

	it('a changed number keeps the old set, ending the day before', () => {
		expect(keepEarlierScores({ a: 5, b: 1 }, null, { a: 5, b: 2 }, '2026-11-21')).toEqual([{ until: '2026-11-21', scores: { a: 5, b: 1 } }]);
		// Numbers turned off: past days keep theirs.
		expect(keepEarlierScores({ a: 5 }, null, {}, '2026-11-21')).toHaveLength(1);
	});

	it('nothing is kept when no number past logs used changes', () => {
		// A number for a new option only.
		expect(keepEarlierScores({ a: 5 }, null, { a: 5, n: 3 }, '2026-11-21')).toEqual([]);
		// The first numbers apply to the past too.
		expect(keepEarlierScores({}, null, { a: 5 }, '2026-11-21')).toEqual([]);
		// A second change on the same day: the set the past used is already kept.
		const once = keepEarlierScores({ a: 5 }, null, { a: 4 }, '2026-11-21');
		expect(keepEarlierScores({ a: 4 }, once, { a: 3 }, '2026-11-21')).toEqual(once);
	});
});
