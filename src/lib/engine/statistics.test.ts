import { describe, expect, it } from 'vitest';
import { changePoint, compareGroups, compareTwo, correlationCI, describeSample, fisherExact, holm, mannWhitney, trendTest, unusualValues, welch } from './statistics';
import { correlate } from './correlate';

// Reference values from SciPy 1.18 (scipy.stats), computed on the same data.
const near = (got: number | null | undefined, want: number, rel = 1e-3) => {
	expect(got).not.toBeNull();
	expect(Math.abs((got as number) - want)).toBeLessThanOrEqual(Math.abs(want) * rel + 1e-9);
};

const a = [5.1, 4.9, 6.2, 5.8, 6.0, 5.5, 5.3, 6.1];
const b = [6.5, 6.9, 7.1, 6.0, 7.4, 6.8, 7.2, 6.6, 7.0];

describe('statistics engine', () => {
	it('describes a sample', () => {
		const d = describeSample([1.2, 2.5, 2.2, 3.9, 3.1, 4.8, 2.7, 3.3]);
		near(d.mean, 2.9625);
		near(d.sd, 1.092752);
		near(d.skewness, 0.1509053, 5e-3);
		near(d.kurtosis, 0.4438373, 5e-3);
		// mean ± t(0.975, 7) × sd / √n
		near(d.meanCI95![0], 2.9625 - 2.364624 * (1.092752 / Math.sqrt(8)));
		expect(d.binary).toBe(false);
		expect(describeSample([1, 0, 1, 1]).binary).toBe(true);
		expect(describeSample([]).n).toBe(0);
		expect(describeSample([1, 2, 3, 4, 100]).outliers).toEqual([4]);
	});

	it("runs Welch's t-test", () => {
		const w = welch(a, b)!;
		near(w.t, 5.505946);
		near(w.df, 14.01605);
		near(w.p, 7.708369e-5);
		near(w.diffCI95![0], 0.7453209);
		near(w.diffCI95![1], 1.696346);
	});

	it('runs Mann-Whitney U with tie and continuity corrections', () => {
		near(mannWhitney(a, b)!.p, 0.001486153);
		near(mannWhitney([3, 4, 4, 5, 6, 6, 7], [5, 5, 6, 6, 7, 8, 8])!.p, 0.1035478);
		expect(mannWhitney(a, b)!.rankBiserial).toBeGreaterThan(0.9);
	});

	it('compares two groups with effect sizes, and yes/no data as proportions', () => {
		const c = compareTwo(a, b);
		expect(c.size).toBe('large');
		expect(c.hedgesG!).toBeGreaterThan(2);
		expect(c.proportions).toBeNull();
		const yes = compareTwo([1, 0, 0, 1, 0, 0, 0, 1, 0, 0], [1, 1, 1, 0, 1, 1, 1, 1, 0, 1]);
		expect(yes.proportions!.a).toBe(0.3);
		expect(yes.proportions!.b).toBe(0.8);
		expect(yes.proportions!.fisherP!).toBeGreaterThan(0.05);
		expect(yes.proportions!.fisherP!).toBeLessThan(0.1);
	});

	it("runs Fisher's exact test", () => {
		near(fisherExact(8, 2, 1, 5), 0.03496503);
		near(fisherExact(3, 1, 1, 3), 0.4857143);
	});

	it('compares several groups: Kruskal-Wallis and ANOVA', () => {
		const g = compareGroups([
			{ label: 'A', values: [2.9, 3.0, 2.5, 2.6, 3.2] },
			{ label: 'B', values: [3.8, 2.7, 4.0, 2.4] },
			{ label: 'C', values: [2.8, 3.4, 3.7, 2.2, 2.0] }
		]);
		near(g.kruskalWallis!.h, 0.7714286);
		near(g.kruskalWallis!.p, 0.6799648);
		near(g.anova!.f, 0.5600733);
		near(g.anova!.p, 0.586633);
		expect(g.groups.map((x) => x.label)).toEqual(['A', 'B', 'C']);
		expect(g.groups[0].vsRest.pHolm!).toBeGreaterThanOrEqual(g.groups[0].vsRest.p!);
	});

	it('corrects several p-values with Holm', () => {
		expect(holm([0.01, 0.04, 0.03, null])).toEqual([0.03, 0.06, 0.06, null]);
	});

	it('finds a trend: least squares with a CI, Mann-Kendall and Sen', () => {
		const t = trendTest([2.1, 2.9, 3.2, 3.0, 4.1, 4.4, 4.0, 5.2, 5.0, 5.9]);
		near(t.ols!.slope, 0.3769697);
		near(t.ols!.p, 8.982666e-6);
		near(t.ols!.r2, 0.9248783);
		near(t.ols!.slopeCI95![0], 0.2893782);
		near(t.ols!.slopeCI95![1], 0.4645612);
		near(t.mannKendall!.senSlope, 0.375);
		near(t.mannKendall!.tau, 0.8222222);
		near(t.mannKendall!.p, 0.001282184);
		expect(trendTest([1, 2]).ols).toBeNull();
	});

	it('finds a change point and says how likely it is by chance', () => {
		const shift = [3, 4, 3, 5, 4, 3, 4, 4, 8, 9, 8, 7, 9, 8, 9, 8];
		const c = changePoint(shift)!;
		expect(c.at).toBe(8);
		expect(c.shift!).toBeGreaterThan(4);
		expect(c.p!).toBeLessThan(0.01);
		// Same every time: the shuffles are seeded.
		expect(changePoint(shift)!.p).toBe(c.p);
		const flat = changePoint([5, 4, 6, 5, 5, 4, 6, 5, 4, 6, 5, 5])!;
		expect(flat.p!).toBeGreaterThan(0.2);
		expect(changePoint([1, 2, 3])).toBeNull();
	});

	it('flags unusual values with modified z-scores', () => {
		const u = unusualValues([10, 11, 9, 10, 12, 10, 11, 40, 10, 9]);
		expect(u.items.map((x) => x.index)).toEqual([7]);
		// Mostly equal values: falls back to the mean absolute deviation.
		expect(unusualValues([1, 1, 1, 1, 1, 1, 9]).items.map((x) => x.index)).toEqual([6]);
		expect(unusualValues([1, 2, 3]).items).toEqual([]);
	});

	it('gives correlations a confidence interval and p-values', () => {
		const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
		const y = [2.1, 2.9, 3.2, 3.0, 4.1, 4.4, 4.0, 5.2, 5.0, 5.9];
		const c = correlate(x, y);
		near(c.pearson, 0.9617059);
		near(c.p, 8.982666e-6, 5e-3);
		near(c.ci95![0], 0.8418063);
		near(c.ci95![1], 0.991166);
		near(correlate(a, b.slice(0, 8)).spearmanP, 0.7357649, 5e-3);
		expect(correlationCI(0.5, 3)).toBeNull();
	});
});
