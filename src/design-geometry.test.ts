// The geometry has one source: tokens.css and the parts in src/styles. A component's <style> and its inline styles
// name a token for spacing, insets, type sizes, corners and shadows, never a typed length, so one edit to a token moves
// every screen and nothing drifts beside it. Global classes keep their one meaning: no component restyles .small, boxed
// .small lives only in the bars, and the retired .actions footer stays gone (ActionsBar is the one footer).
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const files = readdirSync('src', { recursive: true, encoding: 'utf8' })
	.filter((f) => f.endsWith('.svelte'))
	.map((f) => [f.replaceAll('\\', '/'), readFileSync(`src/${f}`, 'utf8')] as const);

// The few literals that aren't geometry, each with its reason. A stale entry fails too, so the list only shrinks.
const allowed: [file: string, declaration: string, reason: string][] = [
	['lib/stats/ui/Breakdown.svelte', 'gap: 2px', "the hairline between one stacked bar's segments: part of the drawn mark, like its 14px height"],
	['lib/stats/ui/Streaks.svelte', 'gap: 2px', "the hairline between a strip's days: part of the drawn mark, like its 10px cells"],
	['routes/(app)/habits/[id]/chain/+page.svelte', 'gap: 2px', "the hairline between the chain's 16px cells, each its own target"],
	['routes/(app)/+page.svelte', 'top: calc((1.5rem + 1.25rem - var(--control-sm)) / 2)', "centres the › on the name and meta lines (24 + 20px) as list-row.css centres the slot; type has no line-height tokens"]
];

const GEOMETRY = /^(?:margin|padding|inset)(?:-[a-z-]+)?$|^(?:gap|row-gap|column-gap|top|right|bottom|left|font|font-size|line-height|box-shadow)$|^border(?:-[a-z]+)*-radius$/;
const lineOf = (src: string, at: number) => src.slice(0, at).split('\n').length;
const styleBlocks = (src: string) => [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => ({ at: m.index + m[0].indexOf('>') + 1, css: m[1].replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')) }));
const markupOf = (src: string) => src.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, (b) => b.replace(/[^\n]/g, ' '));

// A literal rem or px, negative too (a name's digits aren't one), other than 0 and a 1px or 2px edge inside calc() (the border counted toward the pitch).
const typedLength = (value: string) => {
	const edgesOut = value.replace(/calc\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, (c) => c.replace(/(?<![\d.])[12]px\b/g, ''));
	return [...edgesOut.matchAll(/(?<![\w.#]|\w-)(\d*\.?\d+)(?:rem|px)\b/g)].some((m) => Number(m[1]) !== 0);
};

it('component styles name tokens, never a typed length', () => {
	const found: string[] = [];
	const used = new Set<string>();
	for (const [f, src] of files) {
		const chunks = [
			...styleBlocks(src),
			...[...src.matchAll(/\sstyle="([^"]*)"/g)].map((m) => ({ at: m.index, css: m[1] })),
			...[...src.matchAll(/\sstyle:([\w-]+)(?:\|important)?="([^"]*)"/g)].map((m) => ({ at: m.index, css: `${m[1]}: ${m[2]}` }))
		];
		for (const { at, css } of chunks) {
			for (const d of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
				const declaration = `${d[1]}: ${d[2].trim()}`;
				if (!GEOMETRY.test(d[1]) || !typedLength(d[2])) continue;
				const ok = allowed.find(([file, decl]) => file === f && decl === declaration);
				if (ok) used.add(`${ok[0]} ${ok[1]}`);
				else found.push(`${f}:${lineOf(src, at + d.index)} ${declaration}`);
			}
		}
	}
	expect(found).toEqual([]);
	expect(allowed.map(([file, decl]) => `${file} ${decl}`).filter((k) => !used.has(k))).toEqual([]);
});

// .small is Button's 24px size; a local rule of that name (a text size in the Stats cards, once) shrinks the buttons beside it.
it('no component restyles .small', () => {
	const found = files.flatMap(([f, src]) =>
		styleBlocks(src).flatMap(({ at, css }) =>
			[...css.matchAll(/([^{};]+)\{/g)].filter((m) => /(?<![\w-])\.small(?![\w-])/.test(m[1])).map((m) => `${f}:${lineOf(src, at + m.index)} ${m[1].trim()}`)
		)
	);
	expect(found).toEqual([]);
});

// A control is sized by its place: boxed .small only inside a 32px bar (the band, the selection bar, the refused-save banner).
it('boxed .small only in the bars', () => {
	const bars = ['lib/ui/Band.svelte', 'lib/bulk/BulkBar.svelte', 'routes/(app)/+layout.svelte'];
	const found = files
		.filter(([f]) => !bars.includes(f))
		.flatMap(([f, src]) => {
			const markup = markupOf(src);
			return [...markup.matchAll(/\bclass="([^"]*)"|\bclass:small(?![\w-])/g)].filter((m) => m[1] === undefined || m[1].split(/\s+/).includes('small')).map((m) => `${f}:${lineOf(src, m.index)} ${m[0]}`);
		});
	expect(found).toEqual([]);
});

it('no .actions footer: ActionsBar is the one', () => {
	const found = files.flatMap(([f, src]) =>
		[...markupOf(src).matchAll(/\bclass="([^"]*)"/g)].filter((m) => m[1].split(/\s+/).includes('actions')).map((m) => `${f}:${lineOf(src, m.index)} ${m[0]}`)
	);
	expect(found).toEqual([]);
});

// Every button has its 44px touch area from Button's one rule; .hit is only for a control that isn't a button (a tick, a pick).
it('no .hit on a button or a link', () => {
	const found = files.flatMap(([f, src]) =>
		[...markupOf(src).matchAll(/<(button|a|[A-Z]\w*Button)\b[^>]*?\bclass="([^"]*)"/g)].filter((m) => m[2].split(/\s+/).includes('hit')).map((m) => `${f}:${lineOf(src, m.index)} <${m[1]} class="${m[2]}"`)
	);
	expect(found).toEqual([]);
});
