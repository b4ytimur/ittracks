// What someone wants to track, as they would say it: "practise scales 10 minutes every weekday in the
// evening". Reads a name, an amount, how often and when. What it doesn't understand stays in the name:
// nothing typed is lost. Units come from the account; nothing here knows a kind of tracking.
import type { UnitTable } from '../units';

export type Days = { kind: 'every'; every: number } | { kind: 'days'; days: number[] } | { kind: 'times'; times: number; period: 'week' | 'month' };
export type Part = 'Morning' | 'Afternoon' | 'Evening' | 'Night';
export interface Said {
	name: string;
	amount: number | null;
	unit: string | null;
	days: Days;
	part: Part | null;
	/** HH:MM */
	time: string | null;
	/** Something to stop. */
	stop: boolean;
}

// Monday is 0, as everywhere in the app.
const WORKDAYS = [0, 1, 2, 3, 4];
const WEEKEND = [5, 6];
const DAY_WORDS: [string, number][] = [
	['monday|mon|montag|mo', 0],
	['tuesday|tues|tue|dienstag|di', 1],
	['wednesday|wed|mittwoch|mi', 2],
	['thursday|thurs|thur|thu|donnerstag|do', 3],
	['friday|fri|freitag|fr', 4],
	['saturday|sat|samstag|sonnabend|sa', 5],
	['sunday|sun|sonntag|so', 6]
];
const NUMBER_WORDS: Record<string, number> = {};
[
	['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'],
	['ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf']
].forEach((list) => list.forEach((w, i) => (NUMBER_WORDS[w] = i + 1)));
Object.assign(NUMBER_WORDS, { eine: 1, einen: 1, einem: 1, a: 1, an: 1 });
const NUM = `(?:\\d+(?:[.,]\\d+)?|${Object.keys(NUMBER_WORDS).filter((w) => w.length > 2).join('|')})`;
const num = (s: string): number => NUMBER_WORDS[s.toLowerCase()] ?? Number(s.replace(',', '.'));

/** Letters on either side end a word, also ä, ö, ü and ß. */
const word = (src: string) => new RegExp(`(?<![\\p{L}\\d])(?:${src})(?![\\p{L}])`, 'iu');

const PARTS: [string, Part][] = [
	['(?:(?:in|on|during) the |every |each |at )mornings?|mornings|morning(?= *$)|morgens|(?:am|jeden) morgen|vormittags|am vormittag|nach dem aufstehen|after waking up', 'Morning'],
	['(?:(?:in|during) the |every |each )afternoons?|afternoons|afternoon(?= *$)|at (?:noon|midday|lunch)|after lunch|nachmittags|am nachmittag|mittags|am mittag', 'Afternoon'],
	['(?:(?:in|during) the |every |each )evenings?|evenings|evening(?= *$)|after work|after dinner|abends|(?:am|jeden) abend|nach der arbeit|nach dem essen', 'Evening'],
	['at night|(?:every|each) night|nightly|before (?:bed|sleep|going to bed)|nachts|in der nacht|vor dem (?:schlafen(?:gehen)?|einschlafen|bett)', 'Night']
];

const tidy = (s: string) =>
	s
		.replace(/\s+/g, ' ')
		.replace(/\s+([,.;])/g, '$1')
		.replace(/^[\s,.;:·–-]+|[\s,.;:·–-]+$/g, '')
		.trim();
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Words that belong to what was taken out and mean nothing on their own. */
const LOOSE_END = /(?:\s+(?:for|of|at|on|in|um|am|von|für|à|etwa|about|per|pro|je))+$/iu;
const LOOSE_START = /^(?:(?:for|of|at|on|um|am|von|für|à|etwa|about|to)\s+)+/iu;

export function readHabit(text: string, units: UnitTable): Said {
	let rest = ` ${text.replace(/[“”"„]/g, '').replace(/\s+/g, ' ').trim()} `;
	const out: Said = { name: '', amount: null, unit: null, days: { kind: 'every', every: 1 }, part: null, time: null, stop: false };
	/** Take the first match out of what is left. */
	const take = (re: RegExp): RegExpExecArray | null => {
		const m = re.exec(rest);
		if (m) rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`;
		return m;
	};

	// ----- how often -----
	const times = (n: string, period: string): void => void (out.days = { kind: 'times', times: Math.min(31, Math.max(1, Math.round(num(n)))), period: /mon/i.test(period) ? 'month' : 'week' });
	let m: RegExpExecArray | null;
	const PER = '(?:a|per|each|every|pro|die|in der|im|jede)';
	if ((m = take(word(`(${NUM}) ?(?:x|×|times?|mal|days?|tage?) ?${PER} (week|month|woche|monat)`)))) times(m[1], m[2]);
	else if ((m = take(word(`(once|twice|thrice|einmal|zweimal|dreimal|viermal|fünfmal|sechsmal) ${PER} (week|month|woche|monat)`))))
		times(String({ once: 1, einmal: 1, twice: 2, zweimal: 2, thrice: 3, dreimal: 3, viermal: 4, fünfmal: 5, sechsmal: 6 }[m[1].toLowerCase()]), m[2]);
	else if ((m = take(word(`(?:every|alle) (${NUM}) (?:days|tage)`)))) out.days = { kind: 'every', every: Math.min(365, Math.max(1, Math.round(num(m[1])))) };
	else if (take(word('every (?:other|second) day|jeden zweiten tag'))) out.days = { kind: 'every', every: 2 };
	else if (take(word('every (?:other|second) week|jede zweite woche'))) out.days = { kind: 'every', every: 14 };
	else if (take(word('(?:on |every |each )?(?:weekdays?|workdays?|working days?)|werktags|an (?:werktagen|wochentagen)|unter der woche'))) out.days = { kind: 'days', days: WORKDAYS };
	else if (take(word('(?:on |at |every )?(?:the )?weekends?|(?:am|jedes) wochenende'))) out.days = { kind: 'days', days: WEEKEND };
	else if (take(word('every ?day|each day|daily|jeden tag|täglich'))) out.days = { kind: 'every', every: 1 };
	else {
		// Named days: "on Mon, Wed and Fri", "montags", "every Sunday". The two-letter ones only in a list or after a word that asks for a day.
		const one = DAY_WORDS.map(([w]) => w).join('|');
		const list = word(`(?:(?:on|every|each|am|an|jeden|immer) )?(?:${one})s?\\.?(?:(?: ?[,/&+] ?| and | und )(?:${one})s?\\.?)*`);
		const found = list.exec(rest);
		const short = found && /^(?:mo|di|mi|do|fr|sa|so|sun|sat|mon|wed)\.?$/i.test(found[0].trim());
		if (found && !short) {
			take(list);
			const days = new Set<number>();
			for (const w of found[0].toLowerCase().match(/\p{L}+/gu) ?? []) {
				const d = DAY_WORDS.find(([ws]) => ws.split('|').some((x) => x === w || `${x}s` === w));
				if (d) days.add(d[1]);
			}
			out.days = { kind: 'days', days: [...days].sort() };
		} else if (take(word('weekly|once a week|wöchentlich|jede woche|every week'))) out.days = { kind: 'times', times: 1, period: 'week' };
		else if (take(word('monthly|every month|monatlich|jeden monat'))) out.days = { kind: 'times', times: 1, period: 'month' };
	}

	// ----- when -----
	if ((m = take(/(?<![\p{L}\d])(?:at|um|gegen|@) (\d{1,2})(?:[:.](\d{2}))? ?(am|pm|uhr)?(?![\p{L}\d])/iu))) {
		const h = (Number(m[1]) % 24) + (/pm/i.test(m[3] ?? '') && Number(m[1]) < 12 ? 12 : 0) - (/am/i.test(m[3] ?? '') && Number(m[1]) === 12 ? 12 : 0);
		out.time = `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`;
	}
	for (const [src, part] of PARTS) {
		if (!take(word(src))) continue;
		if (!out.time) out.part = part;
		break;
	}
	take(word('today|heute'));

	// ----- something to stop -----
	if ((m = take(/^\s*(?:i want to |ich (?:will|möchte) )?(?:stop|quit|give up|no more|avoid|don['’]?t|do not|aufhören (?:mit|zu)|schluss mit|kein(?:e|en)?|nicht mehr|verzicht auf|no)(?= )/iu))) out.stop = true;
	else if ((m = take(/ (?:aufhören|abgewöhnen|aufgeben) ?$/iu))) out.stop = true;
	else if ((m = take(/ nicht mehr(?= |$)/iu))) out.stop = true;
	else take(/^\s*(?:i want to|i['’]d like to|track|log|ich (?:will|möchte))(?= )/iu);

	// ----- how much -----
	if (!out.stop) {
		const all = [...rest.matchAll(new RegExp(`(?<![\\p{L}\\d.,])(${NUM})(?:( ?)(\\p{L}[\\p{L}%°/]*))?(?![\\p{L}\\d])`, 'giu'))];
		// A number with a unit you have wins over one with a plain word.
		const pick = all.find((x) => x[3] && units.find(x[3])) ?? all.find((x) => x[3] || /^\d/.test(x[1])) ?? null;
		if (pick) {
			const known = pick[3] ? units.find(pick[3]) : null;
			// A plain word is a unit when it ends what is said, "of" follows, or it is written as a German noun: "20 push ups" are ups of nothing.
			const next = rest.slice(pick.index! + pick[0].length);
			if (pick[3] && !known && tidy(next) && !/^\s*(?:of|von|à)\s/iu.test(next) && !/^\p{Lu}/u.test(pick[3])) {
				pick[0] = pick[1];
				pick[3] = '';
			}
			const whole = rest.slice(0, pick.index) + rest.slice(pick.index! + pick[0].length);
			out.amount = num(pick[1]);
			out.unit = known ? known.name : pick[3] ? pick[3] : null;
			// "8 glasses of water": the amount is in glasses, and the water stays. "3 ducks": nothing is left but the ducks.
			if (tidy(whole).replace(LOOSE_START, '').replace(LOOSE_END, '')) rest = `${rest.slice(0, pick.index).replace(/\s(?:for|about|etwa|für|je)\s*$/iu, ' ')} ${rest.slice(pick.index! + pick[0].length).replace(/^\s*(?:of|von|à)\s/iu, ' ')}`;
			else rest = out.unit ?? pick[0];
			if (!Number.isFinite(out.amount) || out.amount <= 0) out.amount = out.unit = null;
		}
	}

	const name = tidy(tidy(rest).replace(LOOSE_END, '').replace(LOOSE_START, ''));
	out.name = upper((name || tidy(text)).slice(0, 120));
	return out;
}

// ----- the sentence it reads back -----

const DAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));
export function daysWords(d: Days): string {
	if (d.kind === 'every') return d.every === 1 ? 'every day' : d.every === 2 ? 'every other day' : d.every === 14 ? 'every other week' : `every ${d.every} days`;
	if (d.kind === 'times') return d.times === 1 ? `once a ${d.period}` : `${d.times} times a ${d.period}`;
	if (d.days.length === 7) return 'every day';
	if (same(d.days, WORKDAYS)) return 'on weekdays';
	if (same(d.days, WEEKEND)) return 'on weekends';
	const names = d.days.map((x) => DAY[x]);
	return `on ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]}`;
}
export const partWords = (s: Pick<Said, 'part' | 'time'>): string => (s.time ? `at ${s.time}` : s.part === 'Night' ? 'at night' : s.part ? `in the ${s.part.toLowerCase()}` : 'any time');
export const amountWords = (s: Pick<Said, 'amount' | 'unit'>): string => (s.amount === null ? 'just done' : `${s.amount}${s.unit ? ` ${s.unit}` : ''}`);
export const sayWords = (s: Said): string => (s.stop ? `${s.name} · to stop` : [s.name, amountWords(s), daysWords(s.days), partWords(s)].join(' · '));
