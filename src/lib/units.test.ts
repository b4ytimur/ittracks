import { describe, expect, it } from 'vitest';
import { effectiveUnit, kindsProblem, readKinds, STARTER, STARTER_KINDS, unitTable, withShownUnits, type UnitKind } from './units';
import { defaultStep } from './task-types';

describe('the starting units', () => {
	it('match every spelling, ignoring case and spaces', () => {
		expect(STARTER.find(' LBS ')?.name).toBe('lb');
		expect(STARTER.find('Kilograms')?.name).toBe('kg');
		expect(STARTER.find('pages')).toBeNull();
		expect(STARTER.same('lbs', 'lb')).toBe(true);
		expect(STARTER.same('Pages', 'pages')).toBe(true);
		expect(STARTER.same('kg', 'lb')).toBe(false);
	});

	it('convert only within a kind', () => {
		expect(STARTER.convert(100, 'kg', 'lb')).toBeCloseTo(220.462, 3);
		expect(STARTER.convert(90, 's', 'min')).toBe(1.5);
		expect(STARTER.convert(5, 'km', 'mi')).toBeCloseTo(3.107, 3);
		expect(STARTER.convertible('kg', 'km')).toBe(false);
		expect(STARTER.factor('kg', 'km')).toBeNull();
		expect(STARTER.convert(7, 'kg', 'pages')).toBe(7);
	});

	// What the fixed table in code gave, before units were data.
	it('give every factor and step they gave before', () => {
		const before: Record<string, [string, number, number]> = { s: ['time', 1 / 60, 15], min: ['time', 1, 5], h: ['time', 60, 0.5], g: ['mass', 0.001, 50], kg: ['mass', 1, 2.5], lb: ['mass', 0.45359237, 5], m: ['distance', 0.001, 100], km: ['distance', 1, 0.5], mi: ['distance', 1.609344, 0.5] };
		for (const [a, [ka, pa, step]] of Object.entries(before)) {
			expect(STARTER.stepOf(a)).toBe(step);
			for (const [b, [kb, pb]] of Object.entries(before)) expect(STARTER.factor(a, b)).toBe(a === b ? 1 : ka === kb ? pa / pb : null);
		}
		expect(STARTER.names()).toHaveLength(9);
	});

	it('say what a unit change can do to logged values', () => {
		expect(STARTER.change('lbs', 'lb')).toEqual({ kind: 'same' });
		expect(STARTER.change('kg', 'lb')).toMatchObject({ kind: 'convertible' });
		expect(STARTER.change('kg', 'plates')).toEqual({ kind: 'relabel' });
		expect(STARTER.change('', 'kg')).toEqual({ kind: 'relabel' });
	});

	it('a duration with no unit is in minutes', () => {
		expect(effectiveUnit({ type: 'duration', unit: '' })).toBe('min');
		expect(effectiveUnit({ type: 'number', unit: '' })).toBe('');
	});

	it('give a field its default step', () => {
		expect(defaultStep('number', 'kg', STARTER)).toBe(2.5);
		expect(defaultStep('number', 'lbs', STARTER)).toBe(5);
		expect(defaultStep('number', 'pages', STARTER)).toBe(1);
		expect(defaultStep('duration', null, STARTER)).toBe(5);
		expect(defaultStep('count', 'kg', STARTER)).toBe(1);
	});

	it('spell every unit and other word once', () => {
		const names = STARTER_KINDS.flatMap((k) => k.units.flatMap((x) => [x.name, ...x.also]));
		expect(new Set(names).size).toBe(names.length);
	});
});

describe('units of your own', () => {
	const mine: UnitKind[] = [
		...STARTER_KINDS.map((k) => (k.id === 'weight' ? { ...k, shown: 'duck', units: [...k.units, { id: 'd', name: 'duck', per: 1.2, step: 1, also: ['ducks'] }] } : k)),
		{ id: 'laps', name: 'Laps', shown: 'lap', units: [{ id: 'l', name: 'lap', per: 1, step: 1, also: [] }] }
	];
	const t = unitTable(mine);
	it('convert, and there and back is the same', () => {
		expect(t.convert(2, 'ducks', 'kg')).toBeCloseTo(2.4, 9);
		for (const from of t.names()) for (const to of t.names()) if (t.convertible(from, to)) expect(t.convert(t.convert(7.3, from, to), to, from)).toBeCloseTo(7.3, 9);
		expect(t.stepOf('Duck')).toBe(1);
		expect(withShownUnits('{weight}', t)).toBe('duck');
	});
	it('in a kind of their own never convert', () => {
		expect(t.convertible('lap', 'kg')).toBe(false);
		expect(t.convertible('lap', 'duck')).toBe(false);
	});
	it('off your list still work where they are used', () => {
		const off = unitTable(mine.map((k) => ({ ...k, units: k.units.map((x) => (x.name === 'lb' ? { ...x, off: true } : x)) })));
		expect(off.names()).not.toContain('lb');
		expect(off.convert(100, 'kg', 'lb')).toBeCloseTo(220.462, 3);
	});
	it('a name is never taken by another unit’s other word', () => {
		const x = unitTable([...STARTER_KINDS, { id: 'k', name: 'Kilos', shown: 'kilo', units: [{ id: 'k', name: 'kilo', per: 1, step: 1, also: [] }] }]);
		expect(x.kindOf('kilo')?.id).toBe('k');
	});
	it('a table that can’t be is refused with its reason', () => {
		expect(kindsProblem(mine)).toBe('');
		expect(kindsProblem(STARTER_KINDS.filter((k) => k.id !== 'time'))).toMatch(/clocks/);
		expect(kindsProblem(STARTER_KINDS.map((k) => (k.id === 'time' ? { ...k, units: k.units.filter((x) => x.name !== 's') } : k)))).toMatch(/clocks/);
		expect(kindsProblem([...STARTER_KINDS, { id: 'x', name: 'Other', shown: 'KG', units: [{ id: 'x', name: 'KG', per: 1, step: 1, also: [] }] }])).toBe('Two units are called “KG” (Weight and Other)');
		expect(kindsProblem([...STARTER_KINDS, { id: 'x', name: 'weight', shown: 'q', units: [{ id: 'x', name: 'q', per: 1, step: 1, also: [] }] }])).toBe('Two kinds are called “weight”');
	});
	it('what was stored before, or can’t be read, reads as the starting ones with the weight unit picked', () => {
		expect(readKinds(undefined, 'lbs').find((k) => k.id === 'weight')!.shown).toBe('lb');
		expect(readKinds(undefined, 'plates').find((k) => k.id === 'weight')!.shown).toBe('plates');
		expect(readKinds([{ broken: true }])).toEqual(STARTER_KINDS);
		expect(readKinds(mine)).toEqual(mine);
	});
});
