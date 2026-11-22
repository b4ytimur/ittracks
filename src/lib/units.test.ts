import { describe, expect, it } from 'vitest';
import { convert, convertible, effectiveUnit, factor, findUnit, sameUnit, unitChange, UNITS } from './units';
import { defaultStep } from './task-types';

describe('unit registry', () => {
	it('matches every spelling of a unit, ignoring case and spaces', () => {
		expect(findUnit(' LBS ')?.key).toBe('lb');
		expect(findUnit('Kilograms')?.key).toBe('kg');
		expect(findUnit('pages')).toBeNull();
		expect(sameUnit('lbs', 'lb')).toBe(true);
		expect(sameUnit('Pages', 'pages')).toBe(true);
		expect(sameUnit('kg', 'lb')).toBe(false);
	});

	it('converts only within a dimension', () => {
		expect(convert(100, 'kg', 'lb')).toBeCloseTo(220.462, 3);
		expect(convert(90, 's', 'min')).toBe(1.5);
		expect(convert(5, 'km', 'mi')).toBeCloseTo(3.107, 3);
		expect(convertible('kg', 'km')).toBe(false);
		expect(factor('kg', 'km')).toBeNull();
		expect(convert(7, 'kg', 'pages')).toBe(7);
	});

	it('says what a unit change can do to logged values', () => {
		expect(unitChange('lbs', 'lb')).toEqual({ kind: 'same' });
		expect(unitChange('kg', 'lb')).toMatchObject({ kind: 'convertible' });
		expect(unitChange('kg', 'plates')).toEqual({ kind: 'relabel' });
		expect(unitChange('', 'kg')).toEqual({ kind: 'relabel' });
	});

	it('a duration with no unit is in minutes', () => {
		expect(effectiveUnit({ type: 'duration', unit: '' })).toBe('min');
		expect(effectiveUnit({ type: 'number', unit: '' })).toBe('');
	});

	it('default steps come from the registry', () => {
		expect(defaultStep('number', 'kg')).toBe(2.5);
		expect(defaultStep('number', 'lbs')).toBe(5);
		expect(defaultStep('number', 'pages')).toBe(1);
		expect(defaultStep('duration', null)).toBe(5);
		expect(defaultStep('count', 'kg')).toBe(1);
	});

	it('every unit and alias is spelled once', () => {
		const names = UNITS.flatMap((u) => [u.key, ...u.aliases]);
		expect(new Set(names).size).toBe(names.length);
	});
});
