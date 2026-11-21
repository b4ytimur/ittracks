// Formulas for custom measures (M7): "[Weight] * (1 + [Reps] / 30)".
// A tiny parser and evaluator, so a formula can never run code: numbers, field names in
// square brackets, + - * / ^, parentheses and a few functions. Nothing else is accepted.

export type Node =
	| { k: 'num'; v: number }
	| { k: 'field'; name: string }
	| { k: 'neg'; a: Node }
	| { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
	| { k: 'call'; fn: Fn; args: Node[] };

export const FUNCTIONS = {
	min: 'Smallest of the values',
	max: 'Largest of the values',
	round: 'Round, optionally to N decimals: round(x, 1)',
	abs: 'Without the sign',
	sqrt: 'Square root'
} as const;
type Fn = keyof typeof FUNCTIONS;

export class FormulaError extends Error {}

type Tok = { t: 'num'; v: number } | { t: 'field'; v: string } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
	const out: Tok[] = [];
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (/\s/.test(c)) {
			i++;
		} else if (/[0-9.]/.test(c)) {
			const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
			if (!m) throw new FormulaError(`"${c}" is not a number`);
			out.push({ t: 'num', v: Number(m[1]) });
			i += m[1].length;
		} else if (c === '[') {
			const end = src.indexOf(']', i);
			if (end < 0) throw new FormulaError('A field name is missing its closing ]');
			const name = src.slice(i + 1, end).trim();
			if (!name) throw new FormulaError('Empty field name: put a field name inside [ ]');
			out.push({ t: 'field', v: name });
			i = end + 1;
		} else if (/[a-z]/i.test(c)) {
			const m = /^[a-z]+/i.exec(src.slice(i))!;
			out.push({ t: 'id', v: m[0].toLowerCase() });
			i += m[0].length;
		} else if ('+-*/^(),×÷'.includes(c)) {
			out.push({ t: 'op', v: c === '×' ? '*' : c === '÷' ? '/' : c });
			i++;
		} else {
			throw new FormulaError(`"${c}" can't be used in a formula`);
		}
	}
	return out;
}

/** Parse a formula, or throw a FormulaError that says what is wrong in plain words. */
export function parse(src: string): Node {
	if (src.length > 300) throw new FormulaError('The formula is too long');
	const toks = tokenize(src);
	let p = 0;
	const peek = () => toks[p];
	const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
	const expect = (v: string) => {
		if (!isOp(v)) throw new FormulaError(v === ')' ? 'A ( is missing its closing )' : `Expected "${v}"`);
		p++;
	};

	function expr(): Node {
		let a = term();
		while (isOp('+') || isOp('-')) {
			const op = (toks[p++] as { v: '+' | '-' }).v;
			a = { k: 'bin', op, a, b: term() };
		}
		return a;
	}
	function term(): Node {
		let a = unary();
		while (isOp('*') || isOp('/')) {
			const op = (toks[p++] as { v: '*' | '/' }).v;
			a = { k: 'bin', op, a, b: unary() };
		}
		return a;
	}
	function unary(): Node {
		if (isOp('-')) {
			p++;
			return { k: 'neg', a: unary() };
		}
		if (isOp('+')) {
			p++;
			return unary();
		}
		return power();
	}
	function power(): Node {
		const a = atom();
		if (isOp('^')) {
			p++;
			return { k: 'bin', op: '^', a, b: unary() };
		}
		return a;
	}
	function atom(): Node {
		const t = peek();
		if (!t) throw new FormulaError('The formula ends too early');
		if (t.t === 'num') {
			p++;
			return { k: 'num', v: t.v };
		}
		if (t.t === 'field') {
			p++;
			return { k: 'field', name: t.v };
		}
		if (t.t === 'id') {
			if (!(t.v in FUNCTIONS))
				throw new FormulaError(`"${t.v}" isn't a function here. Put field names in square brackets, like [${t.v}]`);
			p++;
			expect('(');
			const args: Node[] = [];
			if (!isOp(')')) {
				args.push(expr());
				while (isOp(',')) {
					p++;
					args.push(expr());
				}
			}
			expect(')');
			const fn = t.v as Fn;
			if ((fn === 'abs' || fn === 'sqrt') && args.length !== 1) throw new FormulaError(`${fn}() takes one value`);
			if (fn === 'round' && (args.length < 1 || args.length > 2)) throw new FormulaError('round() takes a value and optionally the decimals');
			if ((fn === 'min' || fn === 'max') && args.length < 1) throw new FormulaError(`${fn}() needs at least one value`);
			return { k: 'call', fn, args };
		}
		if (t.v === '(') {
			p++;
			const e = expr();
			expect(')');
			return e;
		}
		throw new FormulaError(`Didn't expect "${t.v}" here`);
	}

	if (!toks.length) throw new FormulaError('The formula is empty');
	const node = expr();
	if (p < toks.length) {
		const t = toks[p];
		throw new FormulaError(t.t === 'op' && t.v === ')' ? 'There is a ) without a matching (' : 'Something is missing between two parts, like a * or +');
	}
	return node;
}

/** Every field name a formula reads, as written. */
export function fieldsOf(node: Node): string[] {
	const out = new Set<string>();
	const walk = (n: Node) => {
		if (n.k === 'field') out.add(n.name);
		else if (n.k === 'neg') walk(n.a);
		else if (n.k === 'bin') {
			walk(n.a);
			walk(n.b);
		} else if (n.k === 'call') n.args.forEach(walk);
	};
	walk(node);
	return [...out];
}

/** Work a formula out. A missing field or a division by zero gives null, never a made-up 0. */
export function evaluate(node: Node, field: (name: string) => number | null): number | null {
	const ev = (n: Node): number | null => {
		switch (n.k) {
			case 'num':
				return n.v;
			case 'field':
				return field(n.name);
			case 'neg': {
				const a = ev(n.a);
				return a === null ? null : -a;
			}
			case 'bin': {
				const a = ev(n.a);
				const b = ev(n.b);
				if (a === null || b === null) return null;
				if (n.op === '+') return a + b;
				if (n.op === '-') return a - b;
				if (n.op === '*') return a * b;
				if (n.op === '/') return b === 0 ? null : a / b;
				const r = Math.pow(a, b);
				return Number.isFinite(r) ? r : null;
			}
			case 'call': {
				const xs = n.args.map(ev);
				if (xs.some((x) => x === null)) return null;
				const v = xs as number[];
				if (n.fn === 'min') return Math.min(...v);
				if (n.fn === 'max') return Math.max(...v);
				if (n.fn === 'abs') return Math.abs(v[0]);
				if (n.fn === 'sqrt') return v[0] < 0 ? null : Math.sqrt(v[0]);
				const d = Math.max(0, Math.min(6, Math.round(v[1] ?? 0)));
				return Math.round(v[0] * 10 ** d) / 10 ** d;
			}
		}
	};
	const r = ev(node);
	return r === null || !Number.isFinite(r) ? null : r;
}

/** Parse once and keep the result, since the same formula runs on every log. */
const cache = new Map<string, Node | FormulaError>();
export function compile(src: string): Node | FormulaError {
	let c = cache.get(src);
	if (!c) {
		try {
			c = parse(src);
		} catch (e) {
			c = e instanceof FormulaError ? e : new FormulaError('The formula could not be read');
		}
		if (cache.size > 500) cache.clear();
		cache.set(src, c);
	}
	return c;
}

/** The problem with a formula in plain words, or null when it reads fine. */
export function formulaProblem(src: string, known?: string[]): string | null {
	const c = compile(src);
	if (c instanceof FormulaError) return c.message;
	if (known) {
		const lower = known.map((k) => k.toLowerCase());
		const missing = fieldsOf(c).filter((f) => !lower.includes(f.toLowerCase()));
		if (missing.length) return `No number field called ${missing.map((m) => `[${m}]`).join(', ')}`;
	}
	return null;
}
