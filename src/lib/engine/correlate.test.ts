import { describe, expect, it } from 'vitest';
import { correlate, correlationP, fitLine, pearson, ranks, spearman, summarize } from './correlate';

describe('correlate', () => {
	it('summarizes a list', () => {
		const s = summarize([2, 4, 4, 4, 5, 5, 7, 9]);
		expect(s.n).toBe(8);
		expect(s.mean).toBe(5);
		expect(s.median).toBe(4.5);
		expect(s.min).toBe(2);
		expect(s.max).toBe(9);
	});

	it('finds perfect, inverse and missing links', () => {
		expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
		expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
		expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
		expect(pearson([1, 2], [3, 4])).toBeNull();
	});

	it('ranks ties by their average and uses ranks for Spearman', () => {
		expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
		// Monotonic but not linear: Spearman sees a perfect link, Pearson a weaker one.
		const a = [1, 2, 3, 4, 5, 6];
		const b = a.map((x) => x ** 4);
		expect(spearman(a, b)).toBeCloseTo(1);
		expect(pearson(a, b)!).toBeLessThan(0.95);
	});

	it('gives p-values that match the t distribution', () => {
		// r = 0.5 with n = 20: t = 2.449 on 18 degrees of freedom, two-sided p ≈ 0.0248.
		expect(correlationP(0.5, 20)!).toBeCloseTo(0.0248, 3);
		// r = 0.3 with n = 10: p ≈ 0.40, easily chance.
		expect(correlationP(0.3, 10)!).toBeCloseTo(0.3995, 2);
		// Too few pairs to say anything.
		expect(correlationP(0.9, 3)).toBeNull();
	});

	it('fits a line and labels the result', () => {
		expect(fitLine([0, 1, 2], [1, 3, 5])).toEqual({ slope: 2, intercept: 1 });
		const c = correlate([1, 2, 3, 4, 5, 6, 7, 8], [2, 1, 4, 3, 6, 5, 8, 7]);
		expect(c.n).toBe(8);
		expect(c.direction).toBe('up');
		expect(['strong', 'very strong']).toContain(c.strength);
		expect(c.p!).toBeLessThan(0.05);
	});
});
