// The words of a view's sentence (TS.1): "Default shows everything, by time, short rows with streaks, done at
// the end." Each word is one select over the view's state; picking an option gives the next state. Pure, so the
// sentence reads the same on the page, in the band and in tests.
import { DONE_MODES, type ViewState } from './views';

export interface WordOption {
	value: string;
	/** As it stands in the sentence. */
	label: string;
	/** What the band says after it is picked, after the view's name ("now has open rows"). */
	said: string;
	/** A new view kept from this change is called this (TS.10). */
	name: string;
}
export interface Word {
	key: string;
	/** What the word is, for screen readers. */
	what: string;
	value: string;
	/** The word as shown, when it says more than its option (", breaking first"). */
	shown?: string;
	before?: string;
	after: string;
	options: WordOption[];
	pick: (value: string) => ViewState;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : (xs[0] ?? ''));
const opt = (value: string, label: string, said: string, name = cap(label)): WordOption => ({ value, label, said, name });

const SCOPES = {
	all: 'everything',
	now: 'what fits now',
	todo: 'what is still to do',
	due: 'only what is due',
	brk: 'only breaking'
} as const;
type Scope = keyof typeof SCOPES;
const scopeOf = (s: ViewState): Scope[] => {
	const on: Scope[] = [];
	if (s.fits) on.push('now');
	if (s.status === 'due') on.push('todo');
	if (s.direction === 'build') on.push('due');
	if (s.direction === 'break') on.push('brk');
	return on.length ? on : ['all'];
};
const scopeState = (k: Scope): Partial<ViewState> => ({
	fits: k === 'now',
	status: k === 'todo' ? 'due' : 'all',
	direction: k === 'due' ? 'build' : k === 'brk' ? 'break' : 'all'
});

export interface TodayCtx {
	areas: { id: string; name: string }[];
	identities: string[];
	/** Parts of the day are set: "what fits now" and "by part of day" can be said. */
	parts: boolean;
	/** There is something to break or limit. */
	breaking: boolean;
}

/** What Today's view shows: its scope, then any Area or identity it is kept to. */
export function whatWord(s: ViewState, c: TodayCtx): Word {
	const scope = scopeOf(s);
	const areaNames = s.areas.map((id) => (id === '' ? 'no Area' : (c.areas.find((a) => a.id === id)?.name ?? 'an Area'))).filter(Boolean);
	const filters = [areaNames.length ? `in ${and(areaNames)}` : '', s.identity ? `for “${s.identity}”` : ''].filter(Boolean).join(' ');
	const label = [and(scope.map((k) => SCOPES[k])), filters].filter(Boolean).join(' ');
	const pure = scope.length === 1 && !filters;
	const scopes = (Object.keys(SCOPES) as Scope[]).filter((k) => (k !== 'now' || c.parts) && ((k !== 'due' && k !== 'brk') || c.breaking));
	const options = [
		...(pure ? [] : [opt('_', label, `now shows ${label}`)]),
		...scopes.map((k) => opt(`scope:${k}`, [SCOPES[k], filters].filter(Boolean).join(' '), `now shows ${[SCOPES[k], filters].filter(Boolean).join(' ')}`)),
		...c.areas.map((a) => opt(`area:${a.id}`, `${SCOPES[scope[0]]} in ${a.name}`, `now shows only ${a.name}`, a.name)),
		...(s.areas.length ? [opt('area:', `${SCOPES[scope[0]]} in every Area`, 'now shows every Area', 'Every Area')] : []),
		...c.identities.map((i) => opt(`who:${i}`, `${SCOPES[scope[0]]} for “${i}”`, `now shows only “${i}”`, i)),
		...(s.identity ? [opt('who:', `${SCOPES[scope[0]]} for every identity`, 'now shows every identity', 'Every identity')] : [])
	];
	return {
		key: 'what',
		what: 'What it shows',
		value: pure ? `scope:${scope[0]}` : '_',
		shown: label,
		after: ',',
		options,
		pick: (v) => {
			const [k, x] = v.split(/:(.*)/s);
			if (k === 'scope') return { ...s, ...scopeState(x as Scope) };
			if (k === 'area') return { ...s, areas: x ? [x] : [] };
			if (k === 'who') return { ...s, identity: x || null };
			return s;
		}
	};
}

const BY = {
	time: { label: 'by time', state: { group: 'none', sort: 'cue' } },
	part: { label: 'by part of day', state: { group: 'part' } },
	area: { label: 'by Area', state: { group: 'area' } },
	identity: { label: 'by Identity', state: { group: 'identity' } },
	mine: { label: 'in my order', state: { group: 'none', sort: 'manual' } },
	name: { label: 'by name', state: { group: 'none', sort: 'name' } },
	risk: { label: 'at risk first', state: { group: 'none', sort: 'streak' } }
} as const satisfies Record<string, { label: string; state: Partial<ViewState> }>;
type By = keyof typeof BY;
const byOf = (s: ViewState): By => (s.group !== 'none' && s.group in BY ? (s.group as By) : (({ cue: 'time', manual: 'mine', name: 'name', streak: 'risk' }) as Record<string, By>)[s.sort] ?? 'time');

/** How Today's view is arranged: Layout, Sort and Group as one word (TS.3). */
export function byWord(s: ViewState, c: TodayCtx): Word {
	const by = byOf(s);
	const keys = (Object.keys(BY) as By[]).filter((k) => (k !== 'part' || c.parts) && (k !== 'area' || c.areas.length) && (k !== 'identity' || c.identities.length) || k === by);
	return {
		key: 'by',
		what: 'How it is arranged',
		value: by,
		shown: BY[by].label + (s.first && c.breaking ? ', breaking first' : ''),
		after: ',',
		options: keys.map((k) => opt(k, BY[k].label, `is now ${BY[k].label}`)),
		pick: (v) => ({ ...s, ...BY[v as By].state })
	};
}

const ROWS_SAID = { names: 'names only', short: 'short rows', open: 'open rows', full: 'every line' } as const;
const NUMS = { streak: 'streaks', consistency: 'consistency', week: 'this week’s count', total: 'times done', none: '' } as const;
const DONE_SAID: Record<keyof typeof DONE_MODES, [string, string]> = {
	bottom: ['at the end', 'now puts done habits at the end'],
	collapse: ['folded', 'now folds done habits away'],
	keep: ['where it was', 'now leaves done habits where they were'],
	hide: ['hidden', 'now hides done habits']
};

/** Today's sentence, word by word. */
export function todayWords(s: ViewState, c: TodayCtx): Word[] {
	const rows: Word = {
		key: 'rows',
		what: 'How rows look',
		value: s.rows,
		after: s.rows === 'names' ? ',' : '',
		options: (Object.keys(ROWS_SAID) as (keyof typeof ROWS_SAID)[]).map((k) => opt(k, ROWS_SAID[k], `now has ${ROWS_SAID[k]}`)),
		pick: (v) => ({ ...s, rows: v as ViewState['rows'] })
	};
	const num: Word = {
		key: 'num',
		what: 'The number on a row',
		value: s.num,
		after: ',',
		options: (Object.keys(NUMS) as (keyof typeof NUMS)[]).map((k) => (k === 'none' ? opt(k, 'without a number', 'now shows no number on its rows', 'No number') : opt(k, `with ${NUMS[k]}`, `now shows ${NUMS[k]} on its rows`, cap(NUMS[k])))),
		pick: (v) => ({ ...s, num: v as ViewState['num'] })
	};
	const done: Word = {
		key: 'done',
		what: 'Where done habits go',
		value: s.done,
		before: 'done',
		after: '.',
		options: (Object.keys(DONE_SAID) as (keyof typeof DONE_MODES)[]).map((k) => opt(k, DONE_SAID[k][0], DONE_SAID[k][1], `Done ${DONE_SAID[k][0]}`)),
		pick: (v) => ({ ...s, done: v as ViewState['done'] })
	};
	return [whatWord(s, c), byWord(s, c), rows, ...(s.rows === 'names' ? [] : [num]), done];
}

/** The shown words of a sentence, as one line of text ("everything, by time, short rows with streaks, done at the end."). */
export const sentence = (words: Word[]) =>
	words
		.map((w) => [w.before, (w.shown ?? w.options.find((o) => o.value === w.value)?.label ?? '') + w.after].filter(Boolean).join(' '))
		.join(' ');
