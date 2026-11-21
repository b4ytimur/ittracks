// Markdown for notes, long text fields and the journal. Notes are stored as plain Markdown,
// so they export to Obsidian unchanged; this only turns them into safe HTML for display.
// Shared templates carry notes from strangers, so: raw HTML is off, only web, mail and app
// links are kept, and images show as links (a remote image can act as a tracking pixel).
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });

/** http(s), mailto and tel links, plus links inside the app (/habits, #part). Nothing else. */
export function safeHref(url: string): boolean {
	const u = url.trim();
	if (/^(https?:|mailto:|tel:)/i.test(u)) return true;
	// No scheme at all: a path or an anchor. A colon before any / ? # would be a scheme.
	return !/^[^/?#]*:/.test(u) && !u.startsWith('//');
}

md.validateLink = safeHref;

const external = (href: string) => /^(https?:)?\/\//i.test(href);

md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
	const t = tokens[idx];
	if (external(t.attrGet('href') ?? '')) {
		t.attrSet('target', '_blank');
		t.attrSet('rel', 'noopener noreferrer nofollow');
	}
	return self.renderToken(tokens, idx, options);
};

// Images in notes are skipped for now (choice 3): show the picture's address as a link instead.
md.renderer.rules.image = (tokens, idx) => {
	const t = tokens[idx];
	const src = t.attrGet('src') ?? '';
	const alt = md.utils.escapeHtml(t.content || 'image');
	if (!safeHref(src)) return alt;
	const rel = external(src) ? ' target="_blank" rel="noopener noreferrer nofollow"' : '';
	return `<a href="${md.utils.escapeHtml(src)}"${rel}>🖼 ${alt}</a>`;
};

/** Safe HTML for a Markdown note. Empty notes give an empty string. */
export function renderMarkdown(text: string | null | undefined): string {
	if (!text || !text.trim()) return '';
	return md.render(text);
}

/** The note as plain text on one line, for previews and search results. */
export function plainText(text: string | null | undefined): string {
	if (!text) return '';
	const out: string[] = [];
	const walk = (tokens: ReturnType<typeof md.parse>) => {
		for (const t of tokens) {
			if (t.children) walk(t.children);
			else if (t.type === 'text' || t.type === 'code_inline' || t.type === 'code_block' || t.type === 'fence') out.push(t.content);
			else if (t.type === 'softbreak' || t.type === 'hardbreak') out.push(' ');
			if (t.type === 'paragraph_close' || t.type === 'heading_close' || t.type === 'list_item_close') out.push(' ');
		}
	};
	walk(md.parse(text, {}));
	return out.join('').replace(/\s+/g, ' ').trim();
}

/** The start of a note as plain text, cut at a word near `max` characters. */
export function excerpt(text: string | null | undefined, max = 120): string {
	const p = plainText(text);
	if (p.length <= max) return p;
	const cut = p.slice(0, max);
	const sp = cut.lastIndexOf(' ');
	return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}
