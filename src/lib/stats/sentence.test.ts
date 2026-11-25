import { describe, expect, it } from 'vitest';
import { statCard, type StatCard } from './model';
import type { Catalog } from './catalog';
import { chartsOf, fit, pointOf, slotsOf, subjectOf, subjects, works, type Offer } from './sentence';
import type { CardResult } from './engine';

const catalog: Catalog = {
	habits: [
		{ id: 'gym', name: 'Gym', direction: 'build', archived: false, areaId: null, hasCost: false, logged: 9 },
		{ id: 'smoke', name: 'Smoking', direction: 'break', archived: false, areaId: null, hasCost: false, logged: 0 }
	],
	tasks: [
		{ id: 'bench', name: 'Bench press', areaId: null, tags: [], strength: true, cardio: false, targets: true, logged: 9 },
		{ id: 'read', name: 'Read', areaId: null, tags: [], strength: false, cardio: false, targets: false, logged: 4 }
	],
	metrics: [
		{ id: 'w', taskId: 'bench', name: 'Weight', type: 'number', unit: 'kg', repeats: true, targets: true },
		{ id: 'p', taskId: 'read', name: 'Pages', type: 'count', unit: null, repeats: false, targets: false },
		{ id: 'mood', taskId: 'read', name: 'Mood', type: 'choice', unit: null, repeats: false, targets: false, scored: false }
	],
	tags: [],
	areas: [],
	identities: []
};
const o: Offer = { catalog, measures: [], hidden: [] };
const card = (p: object): StatCard => statCard.parse({ id: 'c', ...p });
const volume = card({ what: { source: 'task', taskId: 'bench' }, perLog: 'volume', look: { chart: 'bars' }, bucket: 'week' });

describe('a card as a sentence', () => {
	it('offers what the subject logs', () => {
		const m = (c: StatCard) => slotsOf(c, o).find((s) => s.key === 'measure')!.options.map((x) => x.label);
		expect(m(volume)).toEqual(expect.arrayContaining(['Volume', 'Estimated 1RM, best set', 'Hard sets']));
		expect(m(volume)).not.toContain('Pace');
		expect(m(card({ what: { source: 'field', metrics: ['p'] }, perLog: 'value' }))).toEqual(['The value']);
	});
	it('a Task never offers Pages, and only charts over time have a bucket', () => {
		expect(slotsOf(volume, o).map((s) => s.key)).toEqual(['measure', 'subject', 'bucket', 'range']);
		expect(slotsOf({ ...volume, look: { ...volume.look, chart: 'tile' } }, o).map((s) => s.key)).toEqual(['measure', 'subject', 'range']);
		expect(slotsOf(volume, o)[0].options.map((x) => x.label)).not.toContain('Pages');
	});
	it('keeps a measure the new subject has', () => {
		const other = { ...catalog, tasks: [...catalog.tasks, { ...catalog.tasks[0], id: 'squat', name: 'Squat' }] };
		const r = fit(volume, 'subject', 'task:squat', { ...o, catalog: other })!;
		expect(r).toMatchObject({ moved: '', card: { perLog: 'volume', what: { taskId: 'squat' } } });
	});
	it('moves the measure to one that fits, and says so', () => {
		const r = fit(volume, 'subject', 'field:p', o)!;
		expect(r.card).toMatchObject({ what: { source: 'field', metrics: ['p'] }, perLog: 'value' });
		expect(r.moved).toContain('Pages (Read) has no volume, so this is the value now.');
	});
	it('never returns a card the engine rejects', () => {
		const starts = [volume, card({}), card({ what: { source: 'slips' }, perLog: 'count', look: { chart: 'streak' } }), card({ what: { source: 'field', metrics: ['mood'] }, perLog: 'option', look: { chart: 'breakdown' }, split: 'option', overTime: 'count' })];
		let n = 0;
		for (const c of starts)
			for (const s of slotsOf(c, o))
				for (const v of s.options) {
					const r = fit(c, s.key, v.value, o);
					if (r) {
						expect(works(r.card, o)).toBe(true);
						n++;
					}
				}
		expect(n).toBeGreaterThan(40);
	});
	it('knows what it reads, and leaves what it can’t offer as it is', () => {
		expect(subjectOf(volume)).toBe('task:bench');
		expect(subjectOf(card({ filter: { habits: ['gym'] } }))).toBe('outcomes:gym');
		const two = card({ what: { source: 'field', metrics: ['w', 'p'] }, perLog: 'value' });
		expect(subjects(two, o)[0]).toEqual({ value: 'fields', label: 'Weight, Pages' });
	});
	it('offers only charts that suit the data', () => {
		expect(chartsOf(volume, o)).toEqual(expect.arrayContaining(['bars', 'line', 'tile']));
		expect(chartsOf(volume, o)).not.toContain('streak');
	});
});

describe('the point of a chart', () => {
	const r = (p: Partial<CardResult>): CardResult => ({ chart: 'line', unit: 'kg', kind: 'number', empty: false, notes: [], total: null, previousTotal: null, buckets: [{ key: 'a', label: '1 Nov', from: '', to: '' }, { key: 'b', label: '8 Nov', from: '', to: '' }], series: [], previous: null, rolling: null, goal: null, range: { from: '', to: '' } as never, ...p });
	it('says the last and the highest', () => {
		expect(pointOf(r({ series: [{ key: 'x', label: 'x', values: [90, 85], total: null }] }))).toBe('Last 85 kg (8 Nov). Highest 90 kg (1 Nov).');
		expect(pointOf(r({ series: [{ key: 'x', label: 'x', values: [85, 90], total: null }] }))).toBe('Last 90 kg (8 Nov). The highest so far.');
	});
	it('says the biggest of several, and nothing where there is no point', () => {
		expect(pointOf(r({ series: [{ key: 'a', label: 'A', values: [1], total: 1 }, { key: 'b', label: 'B', values: [4], total: 4 }] }))).toBe('Most: B, 4 kg.');
		expect(pointOf(r({ series: [{ key: 'a', label: 'A', values: [1, null], total: 1 }] }))).toBe('');
		expect(pointOf(r({ empty: true }))).toBe('');
	});
});
