// Every class the global CSS (app.css, styles/*.css) styles is set somewhere in src. A rule for a class nothing sets is
// dead weight, and stays behind when a feature goes (as Edit's did).
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// Classes put together where no search can see them, each with its reason. A stale entry fails too.
const allowed: Record<string, string> = {
	'empty-filtered': 'EmptyState writes empty-{kind}'
};

it('no global class that nothing sets', () => {
	const files = readdirSync('src', { recursive: true, encoding: 'utf8' }).map((f) => f.replaceAll('\\', '/'));
	const read = (f: string) => readFileSync(`src/${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, '');
	// Selectors only: declaration bodies and quoted strings out, so a .5rem or a '.pdf' isn't a class.
	const css = files.filter((f) => f === 'app.css' || /^styles\/[^/]+\.css$/.test(f)).map((f) => read(f).replace(/\{[^{}]*\}/g, '{}').replace(/'[^']*'|"[^"]*"/g, ''));
	const defined = new Set(css.flatMap((s) => [...s.matchAll(/\.(-?[a-z_][\w-]*)/gi)].map((m) => m[1])));
	// Only where a class is set: class="…", class={…} and props that end in Class (itemClass), class:x, classList.add('x').
	// A word elsewhere (a 'week' unit, a 'table' chart) sets nothing. A component's own <style> styles; it doesn't set.
	const code = files.filter((f) => /\.(svelte|ts|html)$/.test(f) && !f.endsWith('.test.ts')).map((f) => read(f).replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')).join('\n');
	const set = new Set<string>();
	for (const m of code.matchAll(/\w*class(?:Name)?=("[^"]*"|\{)|class:([\w-]+)|classList\.\w+\(([^)]*)\)/gi)) {
		let s = m[1] ?? m[2] ?? m[3];
		if (s === '{') for (let d = 1, i = m.index + m[0].length; d && i < code.length; i++) (d += code[i] === '{' ? 1 : code[i] === '}' ? -1 : 0), (s += code[i]);
		for (const w of s.split(/[^\w-]+/)) set.add(w);
	}
	expect([...defined].filter((c) => !(c in allowed) && !set.has(c))).toEqual([]);
	expect(Object.keys(allowed).filter((c) => !defined.has(c) || set.has(c))).toEqual([]);
});
