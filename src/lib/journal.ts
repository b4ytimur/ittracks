// The light journal: long text fields with starter text and prompts, the day note, and the
// Journal page's feed. The journal is a normal habit, so streaks, reminders, Stats and
// templates keep working; this file holds the pure parts shared by the server and the page.
// Notes and journal entries are private: never part of templates or any sharing feature.
import { excerpt } from './markdown';

export interface PromptField {
	id: string;
	prompts: string[];
	promptOrder: 'order' | 'random';
}

export interface StarterField extends PromptField {
	type: string;
	long: boolean;
	starter: string;
}

/** Days since 1970-01-01 for a YYYY-MM-DD date. */
export const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

/** A small stable hash, so "random" gives the same prompt all day on every device. */
function hash(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return h >>> 0;
}

/** The prompt shown on a date: in order (one a day, then round again) or random, but fixed for the day. */
export function promptFor(m: PromptField, date: string): string | null {
	const list = m.prompts.filter((p) => p.trim());
	if (!list.length) return null;
	const i = m.promptOrder === 'random' ? hash(`${m.id}|${date}`) % list.length : ((dayNumber(date) % list.length) + list.length) % list.length;
	return list[i];
}

/**
 * What a new log of a long text field starts with: the day's prompt as a quote (so it is
 * saved with the answer, and reads well in Obsidian), then the starter text.
 */
export function starterFor(m: StarterField, date: string): string {
	if (m.type !== 'text' || !m.long) return '';
	const prompt = promptFor(m, date);
	const parts = [prompt ? `> ${prompt.replace(/\n/g, ' ')}` : '', m.starter.trim()].filter(Boolean);
	return parts.length ? `${parts.join('\n\n')}\n\n` : '';
}

/** Is a long text value still only what the box started with? Then nothing was written. */
export function untouched(m: StarterField, value: unknown, date: string): boolean {
	if (typeof value !== 'string') return value === undefined || value === null;
	return !value.trim() || value.trim() === starterFor(m, date).trim();
}

// ---------- the Journal page ----------

export type JournalItemKind = 'field' | 'log' | 'slip' | 'day';

/** One piece of writing on a day. */
export interface JournalItem {
	kind: JournalItemKind;
	/** Habit (or "Day note") and, for a field, its name. */
	title: string;
	habitId: string | null;
	/** The habit's name, for filters. */
	habit: string | null;
	/** Markdown. */
	text: string;
	/** Where to change it. */
	href: string;
}

export interface JournalDay {
	date: string;
	items: JournalItem[];
	/** Choice answers on that day, like Mood: Good. Scored ones carry their number. */
	moods: { field: string; value: string; score: number | null }[];
	/** Habits done that day, for the export's front matter. */
	done: string[];
}

/** Does a day match a search? Every word must appear in its writing, any case. */
export function matches(day: JournalDay, query: string): boolean {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return true;
	const hay = [...day.items.flatMap((i) => [i.title, i.text]), ...day.moods.map((m) => m.value)].join('\n').toLowerCase();
	return words.every((w) => hay.includes(w));
}

/** The dates "On this day" looks back to: a week, a month and a year ago (when that day exists). */
export function onThisDay(today: string): { label: string; date: string }[] {
	const [y, m, d] = today.split('-').map(Number);
	const iso = (yy: number, mm: number, dd: number) => {
		const t = new Date(Date.UTC(yy, mm - 1, dd));
		// 31 March minus a month is not 31 February: skip days that don't exist.
		if (t.getUTCDate() !== dd) return null;
		return t.toISOString().slice(0, 10);
	};
	const week = new Date(Date.UTC(y, m - 1, d - 7)).toISOString().slice(0, 10);
	return [
		{ label: 'A week ago', date: week },
		{ label: 'A month ago', date: iso(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, d) },
		{ label: 'A year ago', date: iso(y - 1, m, d) }
	].filter((x): x is { label: string; date: string } => !!x.date);
}

/** A short line for a day in lists. */
export const dayExcerpt = (day: JournalDay, max = 140) => excerpt(day.items.map((i) => i.text).join('\n\n'), max);

// ---------- Markdown export (Obsidian daily notes) ----------

const yamlString = (s: string) => (/^[\w .,'-]*$/.test(s) && s.trim() === s && s !== '' ? s : JSON.stringify(s));

/**
 * One day as a Markdown file in the style of an Obsidian daily note: front matter with the
 * mood and the habits done, then each piece of writing under its own heading.
 */
export function dayMarkdown(day: JournalDay): string {
	const fm: string[] = ['---', `date: ${day.date}`];
	for (const m of day.moods) {
		const key = m.field.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'choice';
		fm.push(`${key}: ${yamlString(m.value)}`);
		if (m.score !== null) fm.push(`${key}_score: ${m.score}`);
	}
	if (day.done.length) {
		fm.push('habits:');
		for (const h of day.done) fm.push(`  - ${yamlString(h)}`);
	}
	fm.push('tags: [journal]', '---', '');
	const body: string[] = [`# ${day.date}`, ''];
	for (const i of day.items) {
		body.push(`## ${i.title}`, '', i.text.trim(), '');
	}
	return `${fm.join('\n')}\n${body.join('\n').trimEnd()}\n`;
}
