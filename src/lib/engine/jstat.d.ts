// The parts of jStat (https://github.com/jstat/jstat) the statistics tools use. jStat has no
// types of its own.
declare module 'jstat' {
	interface Dist2 {
		cdf(x: number, a: number): number;
		inv(p: number, a: number): number;
	}
	interface Dist3 {
		cdf(x: number, a: number, b: number): number;
		inv(p: number, a: number, b: number): number;
	}
	const jStat: {
		studentt: Dist2;
		chisquare: Dist2;
		normal: Dist3;
		centralF: Dist3;
		gammaln(x: number): number;
		/** Regularized incomplete beta function. */
		ibeta(x: number, a: number, b: number): number;
	};
	export default jStat;
}
