// Markdown notes, the journal helpers and the export: what a stranger's template can't do,
// and what the journal writes.
import { describe, expect, it } from 'vitest';
import { excerpt, plainText, renderMarkdown, safeHref } from './markdown';
import { dayMarkdown, matches, onThisDay, promptFor, starterFor, untouched, type JournalDay } from './journal';
import { crc32, zip } from './server/zip';

describe('Markdown notes are safe to show', () => {
	it('escapes raw HTML instead of running it', () => {
		const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)> **bold**');
		expect(html).not.toMatch(/<script|<img/);
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('<strong>bold</strong>');
	});

	it('keeps web, mail and app links, and drops script ones', () => {
		expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('href');
		expect(renderMarkdown('[x](JaVaScRiPt:alert(1))')).not.toContain('href');
		expect(renderMarkdown('[x](data:text/html;base64,PHNjcmlwdD4=)')).not.toContain('href');
		expect(renderMarkdown('[x](vbscript:msgbox)')).not.toContain('href');
		expect(renderMarkdown('[form](https://example.com/squat)')).toContain('href="https://example.com/squat"');
		expect(renderMarkdown('[mail](mailto:coach@example.com)')).toContain('href="mailto:coach@example.com"');
		expect(renderMarkdown('[my habits](/habits)')).toContain('href="/habits"');
		expect(safeHref('//evil.example')).toBe(false);
	});

	it('opens outside links in a new tab without handing over the page', () => {
		const html = renderMarkdown('https://example.com');
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener noreferrer nofollow"');
		expect(renderMarkdown('[in app](/library)')).not.toContain('target=');
	});

	it('shows images as links, never loads them (no tracking pixels)', () => {
		const html = renderMarkdown('![form](https://tracker.example/p.gif)');
		expect(html).not.toContain('<img');
		expect(html).toContain('<a href="https://tracker.example/p.gif"');
		expect(renderMarkdown('![x](javascript:alert(1))')).not.toContain('href');
	});

	it('renders tables, strikethrough and line breaks', () => {
		const html = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |\n\n~~old~~\nnext line');
		expect(html).toContain('<table>');
		expect(html).toContain('<s>old</s>');
		expect(html).toContain('<br>');
	});

	it('gives a plain one-line preview', () => {
		expect(plainText('## Wins\n- ran **5 km**\n- [read](https://x.y)')).toBe('Wins ran 5 km read');
		expect(excerpt('word '.repeat(50), 20).length).toBeLessThanOrEqual(21);
		expect(renderMarkdown('   ')).toBe('');
	});
});

describe('journal prompts and starter text', () => {
	const field = { id: 'm1', type: 'text', long: true, starter: '## Wins\n\n## Lessons', prompts: ['One?', 'Two?', 'Three?'], promptOrder: 'order' as const };

	it('shows prompts in order, one a day, then round again', () => {
		const seen = ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24'].map((d) => promptFor(field, d));
		expect(new Set(seen.slice(0, 3)).size).toBe(3);
		expect(seen[3]).toBe(seen[0]);
	});

	it('keeps a random prompt the same all day', () => {
		const r = { ...field, promptOrder: 'random' as const };
		expect(promptFor(r, '2026-11-21')).toBe(promptFor(r, '2026-11-21'));
		expect(field.prompts).toContain(promptFor(r, '2026-11-21'));
		expect(promptFor({ ...field, prompts: [] }, '2026-11-21')).toBeNull();
	});

	it('starts a new log with the prompt as a quote, then the starter text', () => {
		const s = starterFor(field, '2026-11-21');
		expect(s).toMatch(/^> (One|Two|Three)\?\n\n## Wins\n\n## Lessons\n\n$/);
		expect(starterFor({ ...field, long: false }, '2026-11-21')).toBe('');
	});

	it('treats an entry with only the starter text as not written', () => {
		const s = starterFor(field, '2026-11-21');
		expect(untouched(field, s, '2026-11-21')).toBe(true);
		expect(untouched(field, `  ${s.trim()}  `, '2026-11-21')).toBe(true);
		expect(untouched(field, `${s}Ran 5 km`, '2026-11-21')).toBe(false);
		expect(untouched(field, undefined, '2026-11-21')).toBe(true);
	});
});

describe('the Journal page', () => {
	const day: JournalDay = {
		date: '2026-11-21',
		items: [
			{ kind: 'field', title: 'Journal · Entry', habitId: 'h1', habit: 'Journal', text: '> What went well?\n\nThe **long run** felt easy.', href: '/log/o1' },
			{ kind: 'day', title: 'Day note', habitId: null, habit: null, text: 'Dinner with Sam', href: '/' }
		],
		moods: [{ field: 'Mood', value: 'Good', score: 4 }],
		done: ['Journal', 'Run: easy']
	};

	it('finds days by every word, in any case', () => {
		expect(matches(day, 'LONG run')).toBe(true);
		expect(matches(day, 'sam good')).toBe(true);
		expect(matches(day, 'long swim')).toBe(false);
		expect(matches(day, '')).toBe(true);
	});

	it('looks back a week, a month and a year, skipping days that do not exist', () => {
		expect(onThisDay('2026-11-21')).toEqual([
			{ label: 'A week ago', date: '2026-11-14' },
			{ label: 'A month ago', date: '2026-10-21' },
			{ label: 'A year ago', date: '2025-11-21' }
		]);
		expect(onThisDay('2026-03-31').map((x) => x.label)).toEqual(['A week ago', 'A year ago']);
		expect(onThisDay('2026-01-05')[1].date).toBe('2025-12-05');
	});

	it('exports a day as an Obsidian daily note', () => {
		const md = dayMarkdown(day);
		expect(md).toBe(
			[
				'---',
				'date: 2026-11-21',
				'mood: Good',
				'mood_score: 4',
				'habits:',
				'  - Journal',
				'  - "Run: easy"',
				'tags: [journal]',
				'---',
				'',
				'# 2026-11-21',
				'',
				'## Journal · Entry',
				'',
				'> What went well?',
				'',
				'The **long run** felt easy.',
				'',
				'## Day note',
				'',
				'Dinner with Sam',
				''
			].join('\n')
		);
	});
});

describe('zip export', () => {
	it('computes the standard CRC-32', () => {
		expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
	});

	it('writes a zip whose entries read back', () => {
		const files = [
			{ name: 'ittracks-journal/2026-11-20.md', text: '# Hello' },
			{ name: 'ittracks-journal/2026-11-21.md', text: 'Größe ✓' }
		];
		const z = zip(files, new Date(2026, 10, 21, 20, 0, 0));
		const v = new DataView(z.buffer);
		// End of central directory: 2 entries, central directory where it says.
		const end = z.length - 22;
		expect(v.getUint32(end, true)).toBe(0x06054b50);
		expect(v.getUint16(end + 10, true)).toBe(2);
		let p = v.getUint32(end + 16, true);
		const dec = new TextDecoder();
		for (const f of files) {
			expect(v.getUint32(p, true)).toBe(0x02014b50);
			const nameLen = v.getUint16(p + 28, true);
			const size = v.getUint32(p + 24, true);
			const at = v.getUint32(p + 42, true);
			expect(dec.decode(z.slice(p + 46, p + 46 + nameLen))).toBe(f.name);
			// The local header points at the same bytes.
			expect(v.getUint32(at, true)).toBe(0x04034b50);
			const lname = v.getUint16(at + 26, true);
			const data = z.slice(at + 30 + lname, at + 30 + lname + size);
			expect(dec.decode(data)).toBe(f.text);
			expect(v.getUint32(at + 14, true)).toBe(crc32(data));
			p += 46 + nameLen;
		}
	});
});
