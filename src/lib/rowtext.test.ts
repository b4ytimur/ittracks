import { describe, expect, it } from 'vitest';
import { joinRow } from './rowtext';
import { rowsText, type Field, type RowState } from './log/run';
import { fromTemplate, templateFile } from './template';

describe('how a row reads', () => {
	it('a × stands before a field that says so, and nowhere else', () => {
		expect(joinRow([{ text: '60 kg' }, { text: '8', times: true }])).toBe('60 kg × 8');
		expect(joinRow([{ text: '8', times: true }, { text: '60 kg' }])).toBe('60 kg × 8');
		expect(joinRow([{ text: '5 km' }, { text: '30 min' }])).toBe('5 km · 30 min');
		expect(joinRow([{ text: '' }, { text: '8', times: true }])).toBe('8');
	});
	it('rows of two plain numbers are each said in full', () => {
		const f = (id: string, unit: string): Field => ({ id, name: id, type: 'number', unit, prefill: 'last', choices: null });
		const row = (a: number, b: number): RowState => ({ done: true, values: { a, b } });
		expect(rowsText([f('a', 'bpm'), f('b', 'min')], [row(80, 5), row(80, 4)])).toBe('80 bpm · 5 min, 80 bpm · 4 min');
	});
	it('a file from before × was a setting keeps it, and "set"', () => {
		const metrics = [
			{ key: 'w', name: 'Weight', type: 'number', repeats: true },
			{ key: 'r', name: 'Reps', type: 'count', repeats: true },
			{ key: 'n', name: 'Once', type: 'number' }
		];
		const tpl = templateFile.parse({ format: 'ittracks-template', version: 9, name: 'Old', habit: { name: 'Gym', direction: 'build', variants: [{ key: 'v', name: 'Main', slots: [] }], schedule: { kind: 'interval', every: 1, variant: 'v' } }, tasks: [{ key: 't', name: 'Press', metrics }] });
		const form = fromTemplate(tpl, '2026-11-25').tasks[0].form;
		expect(form.metrics.map((m) => m.times)).toEqual([false, true, false]);
		expect([form.rowOne, form.rowMany, form.betweenName]).toEqual(['set', 'sets', 'Rest']);
	});
});
