// The settings as lines of words: which there are, in which group, what each says now and what it
// does. The controls are the page's.
import { backupWords, type BackupPlan, type BackupState } from '$lib/backups';
import { PAST_DAYS_CHOICES } from '$lib/engine/backfill';
import type { DayRange } from '$lib/engine/day';
import type { PastDays } from '$lib/engine/backfill';
import type { Grouping } from '$lib/groupings';
import { PACKS } from '$lib/packs';
import { TIME, type UnitKind } from '$lib/units';
import { FEATURES, type FeatureKey } from '$lib/views';

export interface Now {
	today: string;
	username: string;
	dayStart: string | null;
	ranges: DayRange[];
	vacations: { start: string; end: string; note: string | null }[];
	pastDays: PastDays;
	nudgeYesterday: boolean;
	dayNote: boolean;
	journalOff: boolean;
	guidedSetup: boolean;
	units: UnitKind[];
	measures: { name: string; off?: boolean }[];
	taskTypes: { name: string }[];
	packs: string[];
	groupings: Grouping[];
	startPage: string;
	hidden: FeatureKey[];
	devices: number;
	habits: number;
	keys: { name: string }[];
	backup: { plan: BackupPlan; state: BackupState };
	/** Saves on this device that the server doesn't have yet. */
	waiting: number;
}
export interface Line {
	id: string;
	label: string;
	words: string;
	/** What it does, said once, in the open line. */
	says: string;
	/** Other words someone may look for it by. */
	also?: string;
}
export interface Group {
	id: string;
	title: string;
	lines: Line[];
}

const count = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const names = (xs: string[], max = 4) => (xs.length > max ? `${xs.slice(0, max).join(', ')} and ${xs.length - max} more` : xs.join(', '));
const day = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
export const featureName = (k: FeatureKey) => FEATURES[k].replace(/ \(.*\)$/, '');

function vacation(s: Now): string {
	const next = s.vacations.filter((v) => v.end >= s.today);
	if (!next.length) return 'None planned.';
	const [v, ...more] = next;
	const when = v.start <= s.today ? `On vacation until ${day(v.end)}` : `${day(v.start)} to ${day(v.end)}`;
	return `${when}${v.note ? `, ${v.note}` : ''}${more.length ? `, and ${count(more.length, 'more', 'more')}` : ''}.`;
}

/** What a feature that is off takes away. What you set in it is always kept. */
export const FEATURE_HIDES: Record<FeatureKey, string> = {
	identities: 'Its button, filter and lines leave Today, Habits and a habit’s page.',
	levels: 'Levels leave a habit’s page and Today.',
	rewards: 'Treats and rewards leave a habit’s page and Today.',
	cost: 'Cost leaves a habit’s page, and money saved leaves Today.',
	prep: 'The day before leaves a habit’s page and Today.',
	ifThen: 'If-then plans leave a habit’s page and Today.',
	reframe: 'Reframe lines leave a habit’s page and Today.',
	progression: 'Suggestions to raise a target leave a habit’s page and Today.',
	journal: 'The Journal, the day note and their export leave.'
};

export function settingGroups(s: Now): Group[] {
	const used = Object.keys(FEATURES).length - s.hidden.length;
	const past = PAST_DAYS_CHOICES.find((c) => c.value === s.pastDays)?.label ?? `Up to ${count(s.pastDays ?? 0, 'day')} back`;
	return [
		{
			id: 'day',
			title: 'Your day',
			lines: [
				{ id: 'daystart', label: 'Day starts', words: s.dayStart && s.dayStart !== '00:00' ? `At ${s.dayStart}.` : 'At midnight.', says: 'Logs before this time count for the day before.', also: 'midnight night time' },
				{ id: 'parts', label: 'Parts of the day', words: s.ranges.length ? `${names(s.ranges.map((r) => r.name))}.` : 'None yet.', says: 'A habit can be set for a part instead of an exact time, and reminds you when it starts. Renaming a part keeps its habits on it.', also: 'morning afternoon evening night' },
				{ id: 'vacation', label: 'Vacation', words: vacation(s), says: 'Every habit pauses. Paused days aren’t due and never break a streak; break-habit counters keep running. One habit is paused on its own page.', also: 'pause holiday break rest' },
				{ id: 'past', label: 'Logging past days', words: `${past.replace(/:.*/, '')}.${s.pastDays === 0 ? ' Only today can be logged.' : s.nudgeYesterday ? ' Today asks about yesterday.' : ''}`, says: 'A day you forgot can be logged from Today, History or a habit’s chain, and counts like one logged on the day. A shorter limit keeps streaks honest. Slips can always be added.', also: 'backfill late yesterday reminder nudge' },
				{ id: 'daynote', label: 'Day note', words: s.journalOff ? (s.dayNote ? 'On, and hidden while the Journal is off.' : 'Off. The Journal is off too.') : s.dayNote ? 'On Today, one free note a day.' : 'Off.', says: 'One free note per day, on Today and on each day. It is not a habit and has no streak. Notes are private: they never go into anything you share.', also: 'journal diary notes' }
			]
		},
		{
			id: 'track',
			title: 'What you track',
			lines: [
				{ id: 'newhabits', label: 'New habits', words: s.guidedSetup ? 'Ask how to start.' : 'Open the full page.', says: 'What + Habit opens. Which lines it starts with is chosen there, and at the end of any habit’s page, under On every new habit.', also: 'guided setup editor sections gallery' },
				{ id: 'units', label: 'Units', words: `${names(s.units.filter((k) => !k.off).map((k) => (k.id === TIME ? k.name : `${k.name} in ${k.shown}`)), 6)}.`, says: 'Every number you log can have a unit, and it can be any word. Units of one kind convert into each other; a word that is in no kind never does.', also: `kinds convert step ${s.units.flatMap((k) => k.units.flatMap((x) => [x.name, ...x.also])).join(' ')}` },
				{ id: 'measures', label: 'Measures', words: s.measures.some((m) => !m.off) ? `${names(s.measures.filter((m) => !m.off).map((m) => m.name))}.` : 'None yet.', says: 'A measure is a formula over the fields you log, such as [Weight] * [Reps] or [Distance] / [Time] * 60. Stats cards count logs by them, and a Task’s records list the ones you want.', also: `formula stats records ${s.measures.map((m) => m.name).join(' ')} epley brzycki lombardi` },
				{ id: 'groupings', label: 'Groupings', words: `${names(s.groupings.map((g) => g.name))}.`, says: 'A grouping has members, the tags a Task carries, and levels that say how much. Splitting a Stats card by one counts a log toward each of its Task’s members by the level’s weight: 1 in full, 0.5 half, 0 not at all. Auto-filled slots compare levels by their order.', also: `tags levels stats muscle groups ${s.groupings.flatMap((g) => [g.one, ...g.levels.map((l) => l.name)]).join(' ')}` },
				{ id: 'types', label: 'Task types', words: s.taskTypes.length ? `${names(s.taskTypes.map((t) => t.name))}, and the plain ones.` : 'Only the plain ones.', says: 'What a new Task can start from: its fields, whether a clock runs between rows, and what a row is called.', also: `strength cardio fields ${s.taskTypes.map((t) => t.name).join(' ')}` },
				{ id: 'packs', label: 'Starter packs', words: s.packs.length ? `${names(PACKS.filter((p) => s.packs.includes(p.id)).map((p) => p.name))}.` : 'None.', says: 'A pack copies units, groupings, measures and Task types in. They are yours from then on. Taking a pack out removes only what nothing uses.', also: PACKS.map((p) => `${p.name} ${p.brings}`).join(' ') }
			]
		},
		{
			id: 'look',
			title: 'Look',
			lines: [
				{ id: 'startpage', label: 'Start page', words: `${s.startPage}.`, says: 'What opens when you start the app from its icon, a bookmark or the address bar.', also: 'open home' },
				{ id: 'features', label: 'Features', words: s.hidden.length ? `${used} in use. Off: ${s.hidden.map(featureName).join(', ')}.` : 'All in use.', says: 'One that is off hides its controls everywhere. What you set in it is kept, and is back when you turn it on.', also: `hide switch off ${Object.values(FEATURES).join(' ')}` }
			]
		},
		{
			id: 'reminders',
			title: 'Reminders',
			lines: [{ id: 'reminders', label: 'Reminders', words: s.devices ? `On for ${count(s.devices, 'device')}.` : 'Off on every device.', says: 'A habit with a reminder sends a notification at its time, or when its part of the day starts, if it is due and not done yet. Turn them on for each phone or computer you use.', also: 'push notifications test device' }]
		},
		{
			id: 'data',
			title: 'Data',
			lines: [
				{ id: 'download', label: 'Download your data', words: 'A full backup, or tables for a spreadsheet.', says: 'The backup holds habits, Tasks, every log, slip, note and setting, and can be put back here or on another ittracks server. Tables are a zip of CSV files with a README that explains every column, for Excel, Google Sheets, Python, R or an AI chat.', also: 'export json csv backup' },
				{ id: 'backups', label: 'Automatic backups', words: backupWords(s.backup.plan, s.backup.state, s.today), says: 'A copy of the whole database is written to a folder on the server: habits, Tasks, logs, notes, settings, your login and keys. Beyond the number you keep, the oldest copies are deleted.', also: 'backup auto schedule copy folder database sqlite nightly hourly weekly' },
				{ id: 'restore', label: 'Restore from a backup', words: 'Replaces what is here.', says: 'Every habit, Task, log, note and setting in this account is replaced by the ones in the file. Your login, keys and reminder devices stay.', also: 'import json export' },
				{ id: 'journal', label: 'Download the journal', words: s.journalOff ? 'The Journal is switched off.' : 'Everything you wrote, as Markdown.', says: 'One file per day, named as Obsidian names daily notes, with your mood and the habits you did at the top. Unzip it into your vault.', also: 'obsidian markdown notes export' },
				{ id: 'templates', label: 'Templates', words: 'Save a habit as a file, add one, or look in the Gallery.', says: 'A template holds a habit and its Tasks, with its Areas and what its auto-filled slots pick from. Your logs stay here. Share adds a description and questions for the person adding it.', also: 'share export import habit gallery file' }
			]
		},
		{
			id: 'apps',
			title: 'Other apps',
			lines: [
				{ id: 'keys', label: 'Keys', words: s.keys.length ? `${names(s.keys.map((k) => k.name))}.` : 'None yet.', says: 'A key lets something else use ittracks as you: a Shortcut or a tag that logs, an assistant that reads your logs, a script that makes a backup. Each gets only what you pick.', also: 'api token integrations access revoke' },
				{ id: 'links', label: 'Quick-log links', words: 'Log from a Shortcut, Siri, a tag or a QR code.', says: 'A link logs as soon as it is opened. Signed in, it works without a key. Anyone with a link that has a key in it can log with it, so keep it private.', also: 'nfc shortcut siri android automation integrations' },
				{ id: 'assistants', label: 'AI assistants', words: 'Claude, Cursor and others, over MCP.', says: 'They can read your habits, work out statistics on this server and point to the logs an answer rests on. They log only when you ask.', also: 'mcp claude integrations' },
				{ id: 'scripts', label: 'Scripts', words: 'A backup each night, for example.', says: 'A key with Export access can download the same files as here.', also: 'curl backup api integrations' }
			]
		},
		{
			id: 'account',
			title: 'Account',
			lines: [
				{ id: 'password', label: 'Password', words: `Signed in as ${s.username}.`, says: 'At least 8 characters.', also: 'login account username' },
				{ id: 'logout', label: 'Log out', words: s.waiting ? `${count(s.waiting, 'change')} on this device ${s.waiting === 1 ? 'is' : 'are'} not saved yet.` : 'On this device.', says: 'You stay signed in everywhere else.', also: 'sign out' }
			]
		}
	];
}

/** What is set where it acts: the place, and the way there. */
export const ELSEWHERE: { label: string; place: string; href: string; also: string }[] = [
	{ label: 'Areas', place: 'Habits, grouped by Area: on each Area’s heading', href: '/habits', also: 'colours groups' },
	{ label: 'What a page shows, and its views', place: 'The sentence under each page’s title', href: '/', also: 'views filters sort group layout sections widgets lines rows done customize' },
	{ label: 'View templates', place: 'Today: the view’s name, then Start from', href: '/', also: 'template minimal standard routine week first quitter data nerd starter' },
	{ label: 'Stats boards', place: 'Stats, the boards’ ⋯', href: '/stats', also: 'cards open' },
	{ label: 'App icon shortcuts', place: 'On a habit’s page', href: '/habits', also: 'home screen pinned' },
	{ label: 'Identities', place: 'Identities', href: '/identities', also: 'who you want to be' }
];

/** Every word typed is somewhere in the line. */
export function matches(q: string, ...texts: (string | undefined)[]): boolean {
	const all = texts.join(' ').toLowerCase();
	return q.toLowerCase().split(/\s+/).every((w) => all.includes(w));
}
