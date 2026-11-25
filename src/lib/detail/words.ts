// What each line of a habit says, in one place. No Svelte here, so it can be tested.
import type { HabitForm } from '$lib/forms';

export const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.') : '');
const n = (x: number) => String(Math.round(x * 100) / 100);
const times = (x: number, word: string) => `${x} ${word}${x === 1 ? '' : 's'}`;

/** "After work, at 18:15, at the gym." */
export function cueWords(c: HabitForm['cue'], afterName?: string): string {
	const after = afterName ?? c.afterText?.trim();
	const place = c.place?.trim();
	const parts = [
		after ? `after ${after}` : '',
		c.time ? `at ${c.time}` : c.range ? `in the ${c.range.toLowerCase()}` : '',
		place ? (/^(in|at|on|by|near|under|inside|outside)\s/i.test(place) ? place : `at ${place}`) : ''
	].filter(Boolean);
	return parts.length ? sentence(parts.join(', ')) : '';
}

export function levelWords(l: HabitForm['levels']): string {
	if (!l.enabled) return 'Off.';
	const parts = [
		['Minimum', l.minimum],
		['Target', l.target],
		['Stretch', l.stretch]
	].filter(([, v]) => v.trim());
	return parts.length ? parts.map(([k, v]) => `${k}: ${sentence(v.trim())}`).join(' ') : 'A Minimum, a Target and a Stretch.';
}

export function streakWords(h: Pick<HabitForm, 'streakRule' | 'minimumCounts' | 'unlogged' | 'levels'>, opts: { group: boolean; build: boolean }): string {
	const r = h.streakRule;
	const rule =
		r.kind === 'neverTwice'
			? 'Never miss twice: one miss is forgiven.'
			: r.kind === 'strict'
				? 'Strict: any miss resets it.'
				: r.kind === 'grace'
					? `${times(r.misses, r.misses === 1 ? 'miss' : 'misse')} a ${r.period} ${r.misses === 1 ? 'is' : 'are'} forgiven.`
					: `Consistency over ${r.days} days, no streak.`;
	if (!opts.build) return rule;
	const short = h.minimumCounts ? (h.levels.enabled ? 'A Minimum counts.' : 'Anything logged counts.') : 'Only the full target counts.';
	const forgot = opts.group ? '' : h.unlogged === 'ignore' ? 'A day you don’t log doesn’t count.' : 'A day you don’t log is a miss.';
	return [rule, short, forgot].filter(Boolean).join(' ');
}

export function limitWords(l: HabitForm['limit']): string {
	if (!l) return 'Quit: no limit.';
	const t = l.taper;
	return `${l.max} a ${l.period}.${t ? ` Drops by ${t.by} a ${t.every}, to ${t.floor}.` : ''}`;
}
export const insteadWords = (x: HabitForm['ifThen'], habit?: string) =>
	x.when.trim() || x.then.trim() || habit ? `When I ${x.when.trim() || 'feel the urge'}, I ${[x.then.trim(), habit ? `do ${habit}` : ''].filter(Boolean).join(' or ') || 'do something else'}.` : '';
export const costWords = (c: HabitForm['cost']) => (c ? `${n(c.amount)} ${c.unit} each${c.perDay ? `, ${n(c.perDay)} a day before` : ''}.` : '');
export const treatWords = (b: HabitForm['bundle']) => (b.reward.trim() ? `With ${b.reward.trim()}${b.strict ? ', only after it’s done' : ''}.` : '');
export const jarWords = (j: HabitForm['reward']['jar']) => (j ? `${n(j.amount)} ${j.unit} each time${j.goal.trim() ? `, toward ${j.goal.trim()}` : ''}.` : '');
export const celebrateWords = (r: HabitForm['reward']) => (r.celebrate ? (r.message.trim() ? `Says: ${r.message.trim()}` : 'Says well done.') : '');
export const raiseWords = (p: HabitForm['progression']) =>
	p ? `After ${times(p.after, 'time')} at target, up ${p.unit === 'percent' ? `${n(p.by)}%` : p.by === 1 ? 'a step' : `${n(p.by)} steps`}.` : '';
export const listWords = (xs: string[], empty = '') => xs.map((x) => x.trim()).filter(Boolean).join(', ') || empty;
/** A note's first line, without its marks. */
export const noteWords = (s: string) => s.trim().split('\n').find((l) => l.trim())?.replace(/^[#>\-*\s]+/, '').replace(/\*\*|__|`/g, '').slice(0, 160) ?? '';
