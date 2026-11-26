// Every custom property the app uses is defined somewhere: an old or mistyped name draws nothing and says nothing.
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('no var(--…) without a definition', () => {
	const files = readdirSync('src', { recursive: true, encoding: 'utf8' }).filter((f) => /\.(svelte|css|ts|html)$/.test(f) && !f.endsWith('.test.ts'));
	const all = files.map((f) => [f, readFileSync(`src/${f}`, 'utf8')] as const);
	const defined = new Set(all.flatMap(([, s]) => [...s.matchAll(/(?:^|[^\w(-])(?:style:)?(--[\w-]+)\s*[:=]/g)].map((m) => m[1])));
	const unknown = all.flatMap(([f, s]) => [...s.matchAll(/var\((--[\w-]*[\w])/g)].filter((m) => !defined.has(m[1])).map((m) => `${m[1]} in ${f}`));
	// `--series-${n}` is put together in code.
	expect(unknown.filter((x) => !x.startsWith('--series in'))).toEqual([]);
});

// --pitch is the one spacing length typed: every step is a number of pitches, so changing it changes them all.
it('spacing steps derive from --pitch', () => {
	const css = readFileSync('src/tokens.css', 'utf8');
	const steps = [...css.matchAll(/(--(?:space-(?:tight|inline|group|section|page|indent)|handle-slot)):\s*([^;]+);/g)];
	expect(steps.map(([, name]) => name).sort()).toEqual(['--handle-slot', '--space-group', '--space-indent', '--space-inline', '--space-page', '--space-section', '--space-tight']);
	expect(steps.filter(([, , value]) => /\d(rem|px)/.test(value)).map(([, name]) => name)).toEqual([]);
});
