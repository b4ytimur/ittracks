import { expect, it } from 'vitest';
import { restText } from './rest.svelte';

it('says how much rest is left, and how long it is over', () => {
	expect(restText(72_000, 0)).toBe('Rest 1:12');
	expect(restText(1_000, 999)).toBe('Rest 0:01');
	expect(restText(1_000, 1_000)).toBe('Rest over');
	expect(restText(1_000, 21_000)).toBe('Rest over +0:20');
});
