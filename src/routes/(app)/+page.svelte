<script lang="ts">
	import { enhance } from '$app/forms';
	import { queueable } from '$lib/queueable';
	import { undoShows } from '$lib/echo';
	import { band, dismiss, dismissAbout, hold, release, showError, showToast, undoWith } from '$lib/toast.svelte';
	import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { outbox } from '$lib/outbox.svelte';
	import ViewSentence from '$lib/ViewSentence.svelte';
	import MenuButton from '$lib/ui/MenuButton.svelte';
	import { sentence, todayWords } from '$lib/view-words';
	import { saveLayout } from '$lib/viewclient';
	import { headlineKind, headlineText } from '$lib/engine/stats';
	import { isPartial, progressText } from '$lib/engine/progress';
	import { leftText, rollupDay, rollupText, type LeftOpen } from '$lib/engine/rollup';
	import { invalidateAll } from '$app/navigation';
	import { addDays } from '$lib/engine/dates';
	import DayNote from '$lib/DayNote.svelte';
	import { HINTS, hintNow, type HintId } from '$lib/hints';
	import { PACKS } from '$lib/packs';
	import Box from '$lib/say/Box.svelte';
	import { saveSetting } from '$lib/settings/save';
	import { defaultStep } from '$lib/task-types';
	import { units } from '$lib/units-here';
	import EditableList from '$lib/ui/EditableList.svelte';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import GroupHeading from '$lib/ui/GroupHeading.svelte';
	import LogControl, { type Way } from '$lib/ui/LogControl.svelte';
	import StatusTag from '$lib/ui/StatusTag.svelte';
	import { MediaQuery, SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { keepFocus, rowOf } from '$lib/ui/focus';
	import { reorderFrom, type Mode } from '$lib/ui/list';
	import { usualWay } from '$lib/log/usual';
	import {
		STARTERS,
		STATS,
		fromTemplate,
		groupBy,
		initialState,
		manualOrder,
		partAt,
		passes,
		type FeatureKey,
		type LineKey,
		type StatKey
	} from '$lib/views';

	let { data, form } = $props();
	let slipOpen = $state<string | null>(null);
	/**
	 * A row that was just finished keeps its place for a moment, with its reward and its own Undo;
	 * then it goes where finished rows go, and the band has the Undo.
	 */
	const just = new SvelteMap<string, { words: string; undo?: () => void }>();
	const HOLD_MS = 4500;
	function celebrate(habitId: string, entry?: number, undo?: () => Promise<boolean>) {
		const item = data.build.find((b) => b.habitId === habitId);
		const jar = item?.reward?.jar;
		const words = item?.reward?.celebrate
			? [
					item.reward.message || 'Nice work.',
					jar ? `${fmt(jar.total)} ${jar.unit}${jar.goal ? ` toward ${jar.goal}` : ''}` : ''
				]
					.filter(Boolean)
					.join(' · ')
			: '';
		just.set(habitId, {
			words,
			undo:
				undo &&
				(async () => {
					if (!(await undo())) return void showError('Not undone. Are you online?');
					if (entry) dismiss(entry);
					just.delete(habitId);
					await invalidateAll();
					void keepFocus(nameOf(habitId));
				})
		});
		if (entry) hold(entry);
		setTimeout(() => {
			just.delete(habitId);
			if (entry) release(entry);
		}, HOLD_MS);
	}
	onMount(() => {
		if (data.finished) {
			celebrate(data.finished);
			history.replaceState(history.state, '', '/');
		}
	});
	let feeling = $state('');

	/** Actions taken offline, shown as done until they sync. */
	let pending = $state<Record<string, 'done' | 'skipped'>>({});
	/** Logs finished offline and still waiting in the outbox count as done here. */
	const queuedDone = $derived(
		new Set(
			outbox.items.flatMap((q) => {
				if (q.refused) return [];
				const occ = q.fields.find(([k]) => k === 'occurrence')?.[1];
				if (occ && !q.url.includes('undo')) return [occ];
				const m = q.url.match(/^\/log\/([^/?]+)/);
				const p = q.fields.find(([k]) => k === 'payload')?.[1];
				return m && p?.includes('"finish":true') ? [m[1]] : [];
			})
		)
	);
	const statusOf = (o: { id: string; status: string }): string =>
		pending[o.id] ?? (queuedDone.has(o.id) && o.status === 'due' ? 'done' : o.status);

	// A quick-log link answers here: in the band, or as a notice when it could not.
	let notDue = $state<{ text: string; habit?: string } | null>(null);
	$effect(() => {
		const f = data.flash;
		if (!f) return;
		untrack(() => {
			if (f.kind === 'notDue') notDue = f;
			else if (f.kind === 'error') showError(f.text);
			else showToast(f.text, f.kind === 'did' && f.occurrence ? undoWith('/?/undo', { occurrence: f.occurrence, clear: f.clear ? '1' : '' }) : undefined, f.kind === 'did' ? f.occurrence : undefined);
		});
	});

	// Back from a log: say what was logged and offer Undo.
	onMount(() => {
		const id = page.url.searchParams.get('did');
		if (!id) return;
		const clear = page.url.searchParams.get('clear') === '1';
		// Finished short of what counts for this habit: it stays open, and says why.
		const short = page.url.searchParams.get('short');
		const item = data.build.find((b) => b.occurrence?.id === id);
		if (item && short && item.occurrence?.status === 'due')
			showToast(
				`Saved ${item.name}${item.progress ? `: ${progressText(item.progress)}` : ''}. It counts once it reaches ${short === 'target' ? 'the full target' : 'the Minimum'}, and stays open until the day ends.`
			);
		else if (item) showToast(`Logged ${item.name}.`, undoWith('/?/undo', { occurrence: id, clear: clear ? '1' : '' }), id);
		const u = new URL(page.url);
		u.searchParams.delete('did');
		u.searchParams.delete('clear');
		u.searchParams.delete('short');
		replaceState(u, {});
	});

	type Did = { occurrence: string; habit: string; clear: boolean; undo?: string; skipped?: boolean; short?: 'minimum' | 'target'; left?: LeftOpen[] };
	/** A row's name: it stays put while the row's controls change, so focus waits there. */
	const nameOf = (habitId: string) => `${rowOf(habitId)} a.name`;
	/** After a quick action: say what happened and offer Undo. */
	function afterDid(result: ActionResult) {
		if (result.type !== 'success') return;
		const did = result.data?.did as Did | undefined;
		if (!did) return;
		const undo = undoWith('/?/undo', { occurrence: did.occurrence, clear: did.clear ? '1' : '', undo: did.undo ?? '' });
		// A routine with habits still to do inside it: say which, and why (one waits for its time).
		if (did.left?.length) showToast(`Logged ${did.habit}. ${leftText(did.left)}`, undo);
		// Short of what counts for this habit: it stays open, and says why.
		else if (did.short)
			showToast(
				`Logged ${did.habit}. It counts once it reaches ${did.short === 'target' ? 'the full target' : 'the Minimum'}, and stays open until the day ends.`,
				undo
			);
		else {
			const entry = showToast(`${did.skipped ? 'Skipped' : 'Logged'} ${did.habit}.`, undo, did.occurrence);
			const item = data.build.find((b) => b.occurrence?.id === did.occurrence);
			if (item && !did.skipped) celebrate(item.habitId, entry, undo);
		}
		const item = data.build.find((b) => b.occurrence?.id === did.occurrence);
		if (item) void keepFocus(nameOf(item.habitId));
	}
	/** The row's Undo worked: say so, since the band's line about it goes, and keep focus on the row. */
	function reopened(item: Item) {
		dismissAbout(item.occurrence!.id);
		showToast(`${item.name} is open again.`);
		void keepFocus(nameOf(item.habitId));
	}
	const quick = (occurrenceId: string, name: string, kind: 'done' | 'skipped' = 'done') =>
		queueable(`${name}`, {
			onQueued: () => {
				pending[occurrenceId] = kind;
				showToast(`${kind === 'skipped' ? 'Skipped' : 'Logged'} ${name}. It will sync when you're back online.`);
			},
			after: afterDid
		});

	/** +1 from Today: count one more toward the target, with Undo taking that tap back. */
	const plus = (occurrenceId: string, name: string) =>
		queueable(`${name}`, {
			onQueued: () => showToast(`Counted for ${name}. It will sync when you're back online.`),
			after: (result) => {
				if (result.type !== 'success') return;
				const p = result.data?.plus as { value: number; target: number; unit: string; done: boolean; less?: boolean } | undefined;
				if (!p) return;
				const n = (x: number) => String(Math.round(x * 100) / 100);
				showToast(`${name}: ${n(p.value)} of ${p.less ? 'at most ' : ''}${n(p.target)}${p.unit ? ` ${p.unit}` : ''}${p.done ? '. Done!' : '.'}`, undoWith('/?/plus', { occurrence: occurrenceId, by: '-1' }));
				const item = data.build.find((b) => b.occurrence?.id === occurrenceId);
				if (item) void keepFocus(nameOf(item.habitId));
			}
		});
	const resisted: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await update();
			if (result.type === 'success' && result.data?.cravingId) {
				const id = String(result.data.cravingId);
				showToast('Craving resisted. Nice.', undoWith('/?/uncraving', { id }));
			}
		};
	const stepLabel = (p: { type: string; unit: string; step: number | null }) => {
		const step = p.step ?? defaultStep(p.type, p.unit, units());
		return `+${step}${p.type === 'duration' || (p.type === 'number' && p.unit) ? ` ${p.unit}` : ''}`;
	};

	// Asked the first time it matters: does a log after midnight still count for yesterday?
	let problem = $state('');
	async function startDay(at: string) {
		problem = await saveSetting({ dayStart: at }, () => ({ dayStart: null }), at === '00:00' ? 'The day starts at midnight.' : `The day starts at ${at}.`);
	}
	// A pack from the line under the box.
	async function packIn(id: string, name: string) {
		const r = await fetch('/api/packs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'take', id }) }).catch(() => null);
		const d = await r?.json().catch(() => ({}));
		if (!r?.ok) return void showError(d?.error ?? 'Not added. Are you online?');
		showToast(`${name} is yours now: its units, measures and Task types.`, async () => (await fetch('/api/packs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'undo', undo: d.undo }) }).catch(() => null))?.ok ?? false);
		await invalidateAll();
	}
	// A hint stands once, and goes for good when its thing is done.
	const anyDone = $derived(data.build.some((b) => b.occurrence?.status === 'done'));
	const hint = $derived(hintNow(data.hints, data.build.some((b) => b.occurrence?.status === 'due') ? ['done'] : []));
	let retired = $state<string[]>([]);
	function retire(id: HintId) {
		if (retired.includes(id)) return;
		retired = [...retired, id];
		void fetch('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ set: { hints: [...data.hints, id] }, was: { hints: data.hints } }) }).catch(() => null);
	}
	$effect(() => {
		if (anyDone && !data.hints.includes('done')) untrack(() => retire('done'));
	});

	// ----- The view: one sentence, and every word of it kept with the view (TS.1, TS.2) -----
	let views = $state(untrack(() => data.views));
	let view = $state(untrack(() => initialState(data.views, 'today')));
	let sentenceBar = $state<ReturnType<typeof ViewSentence>>();
	const featureOf: Partial<Record<LineKey, FeatureKey>> = {
		levels: 'levels',
		reframe: 'reframe',
		bundle: 'rewards',
		reward: 'rewards',
		progression: 'progression',
		identities: 'identities'
	};
	const hidden = (f: FeatureKey) => views.hidden.includes(f);
	const featureOn = (k: LineKey) => !(featureOf[k] && hidden(featureOf[k]!));
	/** How much a row says (TS.4): names 0, short 1, open 2, every line 3. Up next is open; a row opened by hand says it all. */
	const RANK = { names: 0, short: 1, open: 2, full: 3 } as const;
	const NEED: Record<LineKey, number> = { cue: 2, headline: 1, levels: 2, bundle: 2, reframe: 3, reward: 3, identities: 3, progression: 3 };
	/** Rows opened with ›, until the page is left. */
	const opened = new SvelteSet<string>();
	const rankOf = (id: string) => (opened.has(id) ? 3 : Math.max(RANK[view.rows], id === upNext && view.rows !== 'names' ? 2 : 0));
	/** A kind of line shows on a row: its feature is on, the view keeps it, and the row says that much. */
	const shows = (id: string, k: LineKey) => featureOn(k) && !view.hide.includes(k) && rankOf(id) >= NEED[k];
	/** In Edit a row lists the hidden kinds too, each with its verb (TS.9). */
	const listed = (id: string, k: LineKey) => featureOn(k) && (editing ? rankOf(id) >= NEED[k] : shows(id, k));
	/** A tracker shows its last value unless it has a number of its own; its logs read "logged". */
	const headlineOf = (item: Item, tracker = false) => {
		if (view.rows === 'names' && !opened.has(item.habitId)) return '';
		const kind = headlineKind(views.today.headlineFor[item.habitId], view.num, tracker);
		if (kind === 'none') return '';
		return data.headlines[item.habitId] ?? headlineText(kind, item.stats, item.streak, { last: item.last, tracker });
	};
	const LINE_SAID: Record<LineKey, string> = { cue: 'when and where', headline: 'the number', levels: 'the Minimum', bundle: 'treats', reframe: 'reframe lines', reward: 'jars and savings', identities: 'identities', progression: 'suggestions to raise' };
	/** Hide or show one kind of line in this view, from a row in Edit. */
	function flipLine(k: LineKey) {
		const off = view.hide.includes(k);
		sentenceBar?.change({ ...view, hide: off ? view.hide.filter((x) => x !== k) : [...view.hide, k] }, `${off ? 'shows' : 'hides'} ${LINE_SAID[k]}`, off ? 'New view' : `Without ${LINE_SAID[k]}`);
	}

	/** Change a Today setting kept for the account (the habit order, folds, one habit's number) here at once, and save it. */
	function setToday(patch: Partial<typeof views.today>): Promise<unknown> {
		const before = views.today;
		views.today = { ...views.today, ...patch };
		return saveLayout({ op: 'patch', today: patch }, () => (views.today = before), () => void setToday(patch));
	}
	const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

	// ----- Edit mode: the same page, with habits to drag and lines to hide -----
	let mode = $state<Mode>('use');
	const editing = $derived(mode === 'edit');
	const folded = (k: string) => views.today.folded.includes(foldKey(k));
	// Stored keys are short and few; a long group name folds by its start.
	const foldKey = (k: string) => k.slice(0, 64);
	const fold = (k: string) => setToday({ folded: toggleIn(views.today.folded, foldKey(k)).slice(-100) });
	/** A move, said once it is saved. */
	const moved = (patch: Partial<typeof views.today>, said: string, undo: () => Promise<boolean>) => void setToday(patch).then((ok) => ok && showToast(said, undo));
	/** A list of habits was reordered: it goes into the one habit order (My order), shared with the Habits page. */
	function reorderHabits(part: string[], said: string) {
		const was = views.today.order;
		const ids = [...data.build, ...data.resting].map((b) => b.habitId);
		const all = [...views.today.order, ...ids.filter((id) => !views.today.order.includes(id))];
		const order = reorderFrom(all, shownBuild.map((b) => b.habitId), part, view.sort === 'manual');
		moved({ order }, said, async () => !!(await setToday({ order: was })));
		if (view.sort !== 'manual' || view.group !== 'none') sentenceBar?.change({ ...view, sort: 'manual', group: 'none' }, 'is in my order now, shared with the Habits page', 'My order');
		return true;
	}
	function setHeadline(habitId: string, v: string) {
		const next = { ...views.today.headlineFor };
		if (v) next[habitId] = v as StatKey;
		else delete next[habitId];
		setToday({ headlineFor: next });
	}

	// The time of day, for "what fits now". Ticks once a minute.
	let now = $state(nowTimeInit());
	function nowTimeInit() {
		return new Date().toTimeString().slice(0, 5);
	}
	onMount(() => {
		const t = setInterval(() => (now = nowTimeInit()), 60_000);
		return () => clearInterval(t);
	});
	const partNames = $derived(data.ranges.map((r) => r.name));
	const currentPart = $derived(partAt(data.ranges, now));
	const partOf = (b: Item) => b.cue.range ?? (b.cue.time ? partAt(data.ranges, b.cue.time) : null);
	let showAll = $state(false);

	/** Every habit the view lets through, groups and the habits inside them alike. */
	const filtered = $derived.by(() => {
		if (view.direction === 'break') return [];
		let list = data.build.filter((b) => passes(view, { ...b, direction: 'build' }));
		if (view.status === 'due') list = list.filter((b) => statusOf(b.occurrence!) === 'due');
		if (view.status === 'done') list = list.filter((b) => statusOf(b.occurrence!) !== 'due');
		if (view.sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
		if (view.sort === 'manual') list = manualOrder(list, views.today.order, (b) => b.habitId);
		if (view.sort === 'streak') list = [...list].sort((a, b) => Number(b.atRisk) - Number(a.atRisk));
		return list;
	});
	// A habit whose group is shown sits inside the group's card; the rest stand on their own.
	const shownIds = $derived(new Set(filtered.map((b) => b.habitId)));
	const sorted = $derived(filtered.filter((b) => !b.parentId || !shownIds.has(b.parentId)));
	const kidsOf = (id: string) => filtered.filter((b) => b.parentId === id);
	/** A group's count today, live: habits done offline count at once. */
	const groupNow = (item: Item) => {
		const g = item.group!;
		// A routine marked Done or Skip offline: it shows as marked until it syncs.
		if (g.routine && statusOf(item.occurrence!) !== item.occurrence!.status) return { done: g.done, total: g.total, status: statusOf(item.occurrence!) };
		const kids = data.build.filter((b) => b.parentId === item.habitId && b.occurrence);
		if (!kids.length) return { done: g.done, total: g.total, status: statusOf(item.occurrence!) };
		const day = rollupDay(kids.map((k) => ({ status: statusOf(k.occurrence!) as 'due' | 'done' | 'skipped' | 'missed' })), g, { past: false });
		return day ? { done: day.done, total: day.total, status: day.status } : { done: g.done, total: g.total, status: statusOf(item.occurrence!) };
	};
	/** "What fits now" keeps what fits this part of the day, what's still due from earlier, and anything without a time. */
	const timeHidden = $derived.by(() => {
		if (!view.fits || showAll || !currentPart) return new Set<string>();
		const at = partNames.indexOf(currentPart);
		return new Set(
			sorted
				.filter((b) => {
					const p = partOf(b);
					if (!p || !partNames.includes(p) || p === currentPart) return false;
					const earlier = partNames.indexOf(p) < at;
					return !(earlier && statusOf(b.occurrence!) === 'due');
				})
				.map((b) => b.habitId)
		);
	});
	const isDone = (b: Item) => statusOf(b.occurrence!) !== 'due';
	/** Finished, and past its moment in place. A group done by its rule with a habit inside still due isn't: that habit is still to do. */
	const settled = (b: Item): boolean => isDone(b) && !just.has(b.habitId) && kidsOf(b.habitId).every(settled);
	const shownBuild = $derived.by(() => {
		let list = sorted.filter((b) => !timeHidden.has(b.habitId));
		if (view.done === 'bottom') list = [...list.filter((b) => !settled(b)), ...list.filter(settled)];
		if (view.done === 'collapse' || view.done === 'hide') list = list.filter((b) => !settled(b));
		return list;
	});
	const doneFolded = $derived(view.done === 'collapse' ? sorted.filter((b) => !timeHidden.has(b.habitId) && settled(b)) : []);
	/** The one row whose Log stands out: what is stacked on something done, or else the first one due. */
	const upNext = $derived.by(() => {
		const due = shownBuild.flatMap((b) => [b, ...kidsOf(b.habitId)]).filter((b) => !isDone(b) && !(b.group && !b.group.routine && kidsOf(b.habitId).length));
		return (due.find((b) => b.upNext) ?? due[0])?.habitId;
	});
	const areaOf = (id: string | null) => data.areas.find((a) => a.id === id);
	/** The habits a list stands for: a group or routine counts through the habits inside it, at any depth. */
	const leavesOf = (items: Item[]): Item[] => items.flatMap((b) => (b.group ? leavesOf(kidsOf(b.habitId)) : [b]));
	const groups = $derived(groupBy(shownBuild.map((b) => ({ ...b, part: partOf(b) })), view.group, { areas: data.areas, parts: partNames }));
	const breakingShown = $derived(view.direction === 'build' ? [] : data.breaking.filter((b) => passes(view, { ...b, direction: 'break' })));
	/** Trackers the view lets through, in its order: by name, or in My order. */
	const trackingShown = $derived.by(() => {
		if (view.direction === 'break') return [];
		const list = data.tracking.filter((b) => passes(view, { ...b, direction: 'build' }));
		if (view.sort === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name));
		if (view.sort === 'manual') return manualOrder(list, views.today.order, (b) => b.habitId);
		return list;
	});
	const identityNames = $derived([...new Set([...data.build, ...data.breaking].flatMap((b) => b.identities))].sort());
	const wordsCtx = $derived({ areas: data.areas, identities: hidden('identities') ? [] : identityNames, parts: data.ranges.length > 0, breaking: data.breaking.length > 0 });
	const words = $derived(todayWords(view, wordsCtx));
	// A group is counted through the habits inside it, as the strip counts.
	const dueLeaves = $derived(data.build.filter((b) => !b.group));
	const doneCount = $derived(dueLeaves.filter(isDone).length);
	/** Everything due is done or skipped. */
	const allDone = $derived(dueLeaves.length > 0 && doneCount === dueLeaves.length && view.direction !== 'break');
	/** The view lets nothing through though there is something today. */
	const nothingShown = $derived(!shownBuild.length && !doneFolded.length && !breakingShown.length && !timeHidden.size && !allDone);

	// ----- The date opens the last seven days (TS.5), History's strip -----
	let strip = $state(false);
	/** From 64rem the side column holds the seven days, always shown (TS.11). */
	const wide = new MediaQuery('min-width: 64rem');
	const weekdayShort = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'narrow' });
	const markOf = (d: { date: string; done: number; of: number }) => {
		const today = d.date === data.today;
		const done = today ? doneCount : d.done;
		const of = today ? dueLeaves.length : d.of;
		if (!of) return null;
		return done >= of ? 'done' : done > 0 ? 'partial' : today ? 'due' : 'missed';
	};
	/** Prepare for tomorrow, Paused and Not due today: one folded line at the end (TS.7). */
	const laterSays = $derived(
		[
			data.prep.length && !hidden('prep') ? `Prepare for tomorrow: ${((n) => `${n} ${n === 1 ? 'thing' : 'things'}`)(data.prep.reduce((n, p) => n + p.items.filter((i) => !i.done).length, 0))}` : '',
			data.paused.length ? `${data.paused.length} paused` : '',
			data.resting.length ? `${data.resting.length} not due today` : ''
		]
			.filter(Boolean)
			.join(' · ')
	);

	// "Yesterday wasn't logged": hidden on this device until the next day, once dismissed.
	const yesterday = $derived(addDays(data.today, -1));
	const yesterdayName = $derived(new Date(`${yesterday}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' }));
	let nudgeHiddenFor = $state<string | null>(null);
	onMount(() => {
		try {
			nudgeHiddenFor = localStorage.getItem('nudge-hidden');
		} catch {
			/* storage blocked */
		}
	});
	function hideNudge() {
		nudgeHiddenFor = yesterday;
		try {
			localStorage.setItem('nudge-hidden', yesterday);
		} catch {
			/* storage blocked */
		}
	}

	const dateLabel = $derived(
		new Date(data.today + 'T12:00:00').toLocaleDateString(undefined, {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		})
	);
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	const fmt = (n: number) =>
		n.toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
	const shortDate = (d: string) =>
		new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
	const limiting = $derived(data.breaking.some((b) => b.limit));
	const nowTime = () => new Date().toTimeString().slice(0, 5);
	const levelName = { minimum: 'Minimum', target: 'Target', stretch: 'Stretch' } as const;

	type Item = (typeof data.build)[number];
	const cueLine = (c: Item['cue']) =>
		[c.after ? `after ${c.after}` : null, c.time ?? c.range, c.place].filter(Boolean).join(' · ');
	const meta = (item: Item) => {
		const o = item.occurrence!;
		const st = item.group ? groupNow(item).status : statusOf(o);
		const g = item.group ? groupNow(item) : null;
		const open = rankOf(item.habitId) >= 2;
		const says = rankOf(item.habitId) >= 1;
		return [
			open && view.group !== 'area' ? areaOf(item.areaId)?.name : null,
			st === 'due' && item.inProgress ? 'In progress' : null,
			says && item.multiVariant ? o.variantName : null,
			g?.total ? rollupText(g) : null,
			says && item.progress && st !== 'skipped' && (st === 'due' || isPartial(item.progress)) ? progressText(item.progress) : null,
			shows(item.habitId, 'cue') ? cueLine(item.cue) : says ? (item.cue.time ?? item.cue.range) : null,
			headlineOf(item)
		]
			.filter(Boolean)
			.join(' · ');
	};
	/** The lines under a row's meta, as much as the view and the row say (TS.4); in Edit with their verbs. */
	const rowLines = (item: Item, st: string) => {
		const o = item.occurrence!;
		const out: { k: LineKey; text: string }[] = [];
		if (item.levels?.minimum && st === 'due') out.push({ k: 'levels', text: `Minimum: ${item.levels.minimum}` });
		if (item.bundle) out.push({ k: 'bundle', text: `${item.bundle.strict ? (o.status === 'done' ? 'Earned' : 'After this') : 'Pair with'}: ${item.bundle.reward}` });
		if (item.reframe) out.push({ k: 'reframe', text: item.reframe });
		if (item.reward?.jar) out.push({ k: 'reward', text: `Jar: ${fmt(item.reward.jar.total)} ${item.reward.jar.unit}${item.reward.jar.goal ? ` toward ${item.reward.jar.goal}` : ''}` });
		if (item.identities.length) out.push({ k: 'identities', text: item.identities.join(' · ') });
		return out.filter((l) => listed(item.habitId, l.k));
	};
	/** Finished, in words: "Done at Minimum". */
	const ended = (item: Item) => {
		const st = item.group ? groupNow(item).status : statusOf(item.occurrence!);
		if (st === 'done') return `Done${item.levels || (item.group && item.occurrence?.level === 'minimum') ? ` at ${levelName[item.occurrence?.level ?? 'target']}` : ''}`;
		return st === 'skipped' ? 'Skipped' : null;
	};
	/** The usual way to log a habit, and the others. */
	function waysOf(item: Item): { act: Way; ways: (Way | '-')[] } {
		const o = item.occurrence!;
		const fields = { occurrence: o.id };
		const log = quick(o.id, item.name);
		const skip: Way = { label: 'Skip today', action: '?/skip', fields, submit: quick(o.id, item.name, 'skipped') };
		if (item.group) return { act: { label: 'Start', href: `/log/${o.id}` }, ways: [{ label: 'Mark all done', action: '?/done', fields, submit: log }, '-', skip] };
		const details: Way[] = o.slotCount ? [{ label: 'Log details…', href: `/log/${o.id}` }] : [];
		const post = o.slotCount ? '?/quick' : '?/done';
		const levels: Way[] =
			item.levels && featureOn('levels') && !item.inProgress && (o.slotCount === 0 || item.quickDone || item.canRepeat)
				? (['minimum', 'target', 'stretch'] as const).map((l) => ({ label: levelName[l], value: item.levels![l], action: post, fields: { ...fields, level: l }, submit: log }))
				: [];
		const rest = [...levels, ...details, '-' as const, skip];
		if (item.progress?.kind === 'amount' && !pending[o.id])
			return { act: { label: stepLabel(item.progress), action: '?/plus', fields, submit: plus(o.id, item.name) }, ways: [...(details.length ? [] : [{ label: 'Log details…', href: `/log/${o.id}` }]), ...rest] };
		if (o.slotCount) {
			const usual = usualWay(item);
			if (usual === 'resume') return { act: { label: 'Resume', href: `/log/${o.id}` }, ways: [skip] };
			if (usual === 'done') return { act: { label: 'Done', action: '?/quick', fields, submit: log }, ways: rest };
			if (usual === 'same') return { act: { label: 'Same as last', action: '?/same', fields, submit: log }, ways: rest };
			return { act: { label: 'Log', href: `/log/${o.id}` }, ways: [...levels, ...(levels.length ? ['-' as const] : []), skip] };
		}
		return { act: { label: 'Done', action: '?/done', fields, submit: log }, ways: levels.length ? rest : [skip] };
	}

	const triggerLine = (t: { kind: string; label: string; percent: number }) =>
		t.kind === 'feeling'
			? `${t.percent}% when ${t.label}`
			: t.kind === 'place'
				? `${t.percent}% at ${t.label}`
				: t.kind === 'with'
					? `${t.percent}% ${/^alone$/i.test(t.label) ? 'alone' : `with ${t.label}`}`
					: `${t.percent}% ${t.label}`;
</script>

<svelte:head><title>Today · ittracks</title></svelte:head>

<EditChrome title="Today" bind:mode modes={['use', 'edit']} hints={{ edit: 'Drag ⠿ to move. Order is shared with Habits.' }}>
	{#snippet useHint()}
		<span class="today-line">
			{#if wide.current}<span class="date">{dateLabel}</span>{:else}<button type="button" class="date" aria-expanded={strip} aria-controls="today-strip" onclick={() => (strip = !strip)}>{dateLabel} <span class="chev" aria-hidden="true">›</span></button>{/if}
			<span class="num">{doneCount} of {dueLeaves.length} done</span>
		</span>
	{/snippet}
	{#snippet actions()}
		{#if data.canBackfill || !hidden('identities')}
			<MenuButton
				class="button"
				label="More on Today"
				items={[...(data.canBackfill ? [{ label: 'Log a past day', href: '/day' }] : []), ...(!hidden('identities') ? [{ label: 'Identities', href: '/identities' }] : [])]}
			/>
		{/if}
	{/snippet}
</EditChrome>

{#if strip && !wide.current}
	<div class="day-week today-strip" id="today-strip" role="group" aria-label="The last seven days">{@render sevenDays()}</div>
{/if}

{#snippet sevenDays()}
	{#each data.week as d (d.date)}
		{@const mark = markOf(d)}
		{@const words = `${shortDate(d.date)}: ${d.of ? `${d.date === data.today ? doneCount : d.done} of ${d.date === data.today ? dueLeaves.length : d.of} done` : 'nothing due'}`}
		{#if d.date < data.today && data.canBackfill}
			<a class="day-cell" href="/day/{d.date}" aria-label="{words}. Log it."><span class="note">{weekdayShort(d.date)}</span><i data-day={mark}></i><span class="note num">{Number(d.date.slice(8))}</span></a>
		{:else}
			<span class="day-cell" aria-current={d.date === data.today ? 'date' : undefined} aria-label={words} role="img"><span class="note">{weekdayShort(d.date)}</span><i data-day={mark}></i><span class="note num">{Number(d.date.slice(8))}</span></span>
		{/if}
	{/each}
{/snippet}

{#if data.askDay}
	<div class="notice" role="note">
		<span class="notice-text">It is past midnight. Is it still {yesterdayName} for you? What you log now counts for that day then.{#if problem} <span class="error">{problem}</span>{/if}</span>
		<span class="notice-acts"><button type="button" class="hit" onclick={() => startDay('04:00')}>Yes, until 04:00</button><button type="button" class="quiet hit" onclick={() => startDay('00:00')}>No, days start at midnight</button></span>
	</div>
{/if}

{#if notDue}
	<div class="notice" role="status">
		<span class="notice-text">{notDue.text}</span>
		<span class="notice-acts">{#if notDue.habit}<a class="button hit" href="/q/{notDue.habit}?go=1&extra=1" data-sveltekit-preload-data="off" onclick={() => (notDue = null)}>Log it anyway</a>{/if}<button type="button" class="quiet hit" onclick={() => (notDue = null)}>Close</button></span>
	</div>
{/if}

{#if data.unlogged.length && nudgeHiddenFor !== yesterday}
	<div class="card nudge row" role="status">
		<span class="grow small-text"
			>Yesterday {data.unlogged.length === 1 ? 'one habit was' : `${data.unlogged.length} habits were`} not logged: {data.unlogged
				.slice(0, 3)
				.join(', ')}{data.unlogged.length > 3 ? ' and more' : ''}. Did you do {data.unlogged.length === 1 ? 'it' : 'them'}?</span
		>
		<a class="button small primary" href="/day/{yesterday}">Log yesterday</a>
		<button class="small link" onclick={hideNudge} aria-label="Hide this until tomorrow">Hide</button>
	</div>
{/if}

{#if !data.build.length && !data.tracking.length && !data.resting.length && !data.breaking.length && !data.paused.length}
	<Box hint="Write it as you would say it: what, how much, how often. Anything you can count or do." />
	<section class="ob-sec" aria-label="Or start from">
		<p class="meta muted">Or start from</p>
		<div class="chips">
			{#each PACKS.filter((p) => !data.packs.includes(p.id)) as p (p.id)}<button type="button" class="toggle" onclick={() => packIn(p.id, p.name)}>{p.name}</button>{/each}
		</div>
		<div class="l-cluster"><a class="button hit" href="/gallery">Gallery</a><a class="button hit" href="/habits/import">Add a file</a><a class="quiet hit" href="/habits/new">Step by step</a></div>
	</section>
{:else}
	<ViewSentence bind:this={sentenceBar} page="today" bind:views bind:current={view} {words} starters={STARTERS()} {mode} reset={fromTemplate(views.template).defaults.today} say={(s) => sentence(todayWords(s, wordsCtx))} />
	{#if hint && !retired.includes(hint) && mode === 'use'}
		<div class="ob-hint" role="note"><span class="meta">{HINTS[hint]}</span><button type="button" class="quiet hit" onclick={() => hint && retire(hint)}>Got it</button></div>
	{/if}

	<div class="today-cols">
		<div class="today-day">
			{#if view.first && breakingShown.length}{@render breaking()}{/if}
			<!-- Beside Breaking, the day takes a heading of the same kind, so both columns start alike (TS.11). -->
			{#if wide.current && !view.first && groups.length && !groups[0].label}<GroupHeading title="Due today" {mode} />{/if}
			{#if allDone}<p class="all-done">Everything due today is done.</p>{/if}
			{#if nothingShown}<EmptyState kind="filtered" text="Nothing today matches {words[0].shown ?? 'this view'}." onclear={() => sentenceBar?.change({ ...view, fits: false, status: 'all', direction: 'all', areas: [], identity: null }, 'now shows everything', 'Everything')} />{/if}
			{#each groups as g (g.key)}
				{@const a = view.group === 'area' ? areaOf(g.key) : undefined}
				{#if g.label}
					<GroupHeading title={a?.name ?? g.label} icon={a?.icon} color={g.color} {mode} folded={folded(`group:${g.key}`)} onfold={() => fold(`group:${g.key}`)} />
				{/if}
				{#if !g.label || !folded(`group:${g.key}`)}{@render habitList(g.items, g.label || 'Today')}{/if}
			{/each}
			{@render timeLine()}
			{#if doneFolded.length}
				<GroupHeading title="Done" {mode} count={String(leavesOf(doneFolded).length)} folded={folded('done')} onfold={() => fold('done')} />
				{#if !folded('done')}{@render habitList(doneFolded, 'Done today')}{/if}
			{/if}
		</div>
		<div class="today-side">
			{#if wide.current}
				<GroupHeading title="Last seven days" {mode} />
				<div class="day-week week-side" role="group" aria-label="The last seven days">{@render sevenDays()}</div>
			{/if}
			{#if !view.first && breakingShown.length}{@render breaking()}{/if}
			{#if trackingShown.length}
				<!-- Trackers keep what you log: never due or missed, so they sit beside the day, not in it. -->
				<GroupHeading title="Tracking" {mode} count={String(trackingShown.length)} folded={folded('tracking')} onfold={() => fold('tracking')} />
				{#if !folded('tracking')}{@render trackingSection()}{/if}
			{/if}
			{#if laterSays && view.direction === 'all' && !view.fits && !editing}
				<section class="later" aria-label="Later and not today">
					<button type="button" class="later-line" aria-expanded={!folded('later')} onclick={() => fold('later')}><span class="chev" aria-hidden="true">›</span><span>{laterSays}</span></button>
					{#if !folded('later')}
						{@render prepSection()}
						{#if data.paused.length}{@render pausedSection()}{/if}
						{#if data.resting.length}{@render restingSection()}{/if}
					{/if}
				</section>
			{/if}
		</div>
	</div>
{/if}

{#if data.habitCount > 0 && data.habitCount < 3 && mode === 'use'}
	<section class="ob-sec" aria-label="Another habit"><Box question="What else do you want to track?" /></section>
{/if}

{#snippet breaking()}
	<GroupHeading title={limiting ? 'Breaking and limiting' : 'Breaking'} {mode} verb={editing ? moveBreaking : undefined} />
	{#snippet moveBreaking()}<button type="button" class="quiet verb hit" onclick={() => sentenceBar?.change({ ...view, first: !view.first }, view.first ? 'puts breaking after the day' : 'puts breaking first', 'Breaking first')}>{view.first ? 'Move last' : 'Move first'}</button>{/snippet}
	{@render breakingSection()}
{/snippet}

{#snippet fold1(id: string, name: string)}
	{#if !editing && rankOf(id) < 3}
		<button type="button" class="fold row-fold" aria-expanded={opened.has(id)} aria-label="{opened.has(id) ? 'Less' : 'More'} about {name}" onclick={() => (opened.has(id) ? opened.delete(id) : opened.add(id))}><span class="chev" aria-hidden="true">›</span></button>
	{:else if !editing && opened.has(id)}
		<button type="button" class="fold row-fold" aria-expanded="true" aria-label="Less about {name}" onclick={() => opened.delete(id)}><span class="chev" aria-hidden="true">›</span></button>
	{/if}
{/snippet}

{#snippet lineOf(l: { k: LineKey; text: string; warn?: boolean })}
	<p class="row-line meta" class:warn={l.warn} class:line-off={editing && view.hide.includes(l.k)}>
		<span>{l.text}</span>{#if editing}<button type="button" class="quiet hit line-verb" aria-label="{view.hide.includes(l.k) ? 'Show' : 'Hide'} {LINE_SAID[l.k]} in this view" onclick={() => flipLine(l.k)}>{view.hide.includes(l.k) ? 'Show' : 'Hide'}</button>{/if}
	</p>
{/snippet}

{#snippet habitList(items: Item[], name: string)}
	<EditableList
		{items}
		key={(b) => b.habitId}
		label={(b) => b.name}
		{mode}
		rowCard
		holder={(b) => !!b.group && kidsOf(b.habitId).length > 0}
		itemClass={(b) => [isDone(b) && statusOf(b.occurrence!) === 'skipped' ? 'skipped' : isDone(b) ? 'done' : '', just.has(b.habitId) ? 'just-done' : '', b.afterHabitId && view.group !== 'area' ? 'stacked' : ''].join(' ')}
		ariaLabel={name}
		onmove={(_, order, text) => reorderHabits(order, text)}
	>
		{#snippet row(item)}{@render habitRow(item)}{/snippet}
		{#snippet actions(item)}{@render verb(item)}{/snippet}
		{#snippet children(item)}{@render habitList(kidsOf(item.habitId), `Inside ${item.name}`)}{/snippet}
	</EditableList>
{/snippet}

{#snippet habitRow(item: Item)}
	{@const o = item.occurrence!}
	{@const st = item.group ? groupNow(item).status : statusOf(o)}
	{@const done = ended(item)}
	{#if st === 'due' && !item.group}{@render fold1(item.habitId, item.name)}{/if}
	<a class="name" href="/habits/{item.habitId}/chain">{item.name}</a>
	{#if (item.habitId === upNext && !editing) || (item.progression && featureOn('progression') && !view.hide.includes('progression') && !shows(item.habitId, 'progression') && st === 'due')}
		<span class="tags">{#if item.habitId === upNext && !editing}<StatusTag status="upNext" />{/if}{#if item.progression && featureOn('progression') && !view.hide.includes('progression') && !shows(item.habitId, 'progression') && st === 'due'}<span class="tag">Raise?</span>{/if}</span>
	{/if}
	{#if done || meta(item)}
		<p class="meta-line">
			{#if done}<span class="mark" aria-hidden="true">{st === 'skipped' ? '↷' : '✓'}</span> {done}{#if just.get(item.habitId)?.words}{' · '}{just.get(item.habitId)?.words}{/if}{meta(item) ? ' · ' : ''}{/if}{meta(item)}
		</p>
	{/if}
	{#if item.atRisk && st === 'due'}<p class="row-line warn meta">You missed last time. Don't miss twice{item.levels ? ': even the Minimum counts' : ''}.</p>{/if}
	{#each rowLines(item, st) as l (l.k)}{@render lineOf(l)}{/each}
	{#if item.progression && st === 'due' && listed(item.habitId, 'progression')}
		{@const p = item.progression}
		<div class="notice" data-mode={mode} class:line-off={editing && view.hide.includes('progression')}>
			<span class="notice-text meta"
				>You've hit your targets {p.hits} times in a row. Raise them by {p.by}{p.unit === 'percent' ? '%' : p.by === 1 ? ' step' : ' steps'}? {p.changes.join(' · ')}</span
			>
			<span class="notice-acts">
				{#if editing}<button type="button" class="quiet hit" onclick={() => flipLine('progression')}>{view.hide.includes('progression') ? 'Show' : 'Hide'}</button>{:else}
					<form method="POST" action="?/raise" use:enhance><input type="hidden" name="habit" value={item.habitId} /><button class="quiet hit" aria-label="Raise the targets of {item.name}">Raise</button></form>
					<form method="POST" action="?/notYet" use:enhance><input type="hidden" name="habit" value={item.habitId} /><button class="quiet hit" aria-label="Not yet for {item.name}">Not yet</button></form>
				{/if}
			</span>
		</div>
	{/if}
	{#if form?.raised === item.habitId}<p class="row-line meta">Targets raised. Keep going.</p>{/if}
	{#if editing && !item.group}{@render headlinePick(item)}{/if}
{/snippet}

{#snippet verb(item: Item)}
	{@const o = item.occurrence!}
	{@const st = item.group ? groupNow(item).status : statusOf(o)}
	{#if item.group && !item.group.routine}
		<!-- A group is done through the habits inside it. -->
	{:else if st === 'due'}
		{@const w = waysOf(item)}
		<LogControl name={item.name} act={w.act} ways={w.ways} primary={item.habitId === upNext} />
	{:else if !pending[o.id]}
		{#if item.group || o.slotCount > 0}<a class="quiet hit" href="/log/{o.id}" aria-label="View {item.name}">View</a>{/if}
		{@const undo = just.get(item.habitId)?.undo}
		{#if undo}
			<button type="button" class="quiet hit" aria-label="Undo {item.name}" onclick={undo}>Undo</button>
		{:else if !undoShows(band.entries, o.id) && (!item.group || item.group.undoable)}
			<!-- One Undo at a time: the band's while its line is this one, else the row's (after a reload too).
			     A routine done only through the habits inside it has nothing of its own to undo. -->
			<form method="POST" action="?/undo" use:enhance={() => async ({ result, update }) => { await update(); if (result.type === 'success') reopened(item); }}>
				<input type="hidden" name="occurrence" value={o.id} />
				<button class="quiet hit" aria-label="Undo {item.name}">Undo</button>
			</form>
		{/if}
	{/if}
{/snippet}

{#snippet headlinePick(item: Item)}
	<label class="headline-pick small-text"
		>Headline
		<select value={views.today.headlineFor[item.habitId] ?? ''} onchange={(e) => setHeadline(item.habitId, e.currentTarget.value)}>
			<option value="">This view's ({view.num === 'none' ? 'none' : STATS[view.num]})</option>
			{#each Object.entries(STATS) as [k, label] (k)}<option value={k}>{label}</option>{/each}
		</select>
	</label>
{/snippet}

{#snippet timeLine()}
	{#if timeHidden.size}
		<p class="muted small-text">
			Showing what fits {currentPart}. <button class="link" onclick={() => (showAll = true)}>Show all ({timeHidden.size} more)</button>
		</p>
	{:else if showAll && view.fits}
		<p class="muted small-text"><button class="link" onclick={() => (showAll = false)}>Only show what fits now</button></p>
	{/if}
{/snippet}

{#snippet breakingSection()}
	<EditableList items={breakingShown} key={(b) => b.habitId} label={(b) => b.name} mode="use" rowCard ariaLabel={limiting ? 'Limits' : 'Breaking'}>
		{#snippet row(b)}
			{@const plan = b.ifThen}
			{@render fold1(b.habitId, b.name)}
			<a class="name" href="/habits/{b.habitId}/chain">{b.name}</a>
			<p class="meta-line">
				{[
					b.limit ? `${b.limit.used} of ${b.limit.max} ${b.limit.period === 'week' ? 'this week' : 'today'}` : null,
					`${plural(b.days, b.limit?.period === 'week' ? 'week' : 'day')}${b.limit ? ' within limit' : ''}`,
					b.limit || rankOf(b.habitId) < 3 ? null : `longest ${plural(b.longest, 'day')}`,
					b.slippedToday && !b.limit ? `${b.slippedToday} today` : null,
					b.resistedThisWeek ? `resisted ${b.resistedThisWeek}× this week` : null
				]
					.filter(Boolean)
					.join(' · ')}
			</p>
			{#if b.limit && b.limit.used > b.limit.max}<p class="row-line warn meta">Over the limit.</p>{/if}
			{#if b.limit?.next && rankOf(b.habitId) >= 2}<p class="row-line meta">{b.limit.next.max} from {shortDate(b.limit.next.date)}</p>{/if}
			{#if plan && (plan.then || plan.habit) && !hidden('ifThen') && shows(b.habitId, 'cue')}
				<p class="row-line meta">If I {plan.when || 'feel the urge'}, I will {[plan.then, plan.habit].filter(Boolean).join(' or ')}.</p>
			{/if}
			{#if b.reframe && !hidden('reframe') && shows(b.habitId, 'reframe')}<p class="row-line meta">{b.reframe}</p>{/if}
			{#if b.cost && !hidden('cost') && !view.hide.includes('reward') && rankOf(b.habitId) >= 3}
				<p class="row-line meta">Slips this month cost {fmt(b.cost.month)} {b.cost.unit}{b.cost.saved !== null ? ` · saved ${fmt(b.cost.saved)} ${b.cost.unit} so far` : ''}</p>
			{/if}
			{#if form?.habit === b.habitId && form?.error}<p class="row-line error meta">{form.error}</p>{/if}
			{#if b.top.length && rankOf(b.habitId) >= 3}<p class="row-line meta">Most slips: {b.top.slice(0, 2).map(triggerLine).join(' · ')}</p>{/if}
			{#if b.identities.length && shows(b.habitId, 'identities')}<p class="row-line meta">{b.identities.join(' · ')}</p>{/if}
			{#if slipOpen === b.habitId}
				<div class="row-line">
						<form
							method="POST"
							action="?/slip"
							class="stack slip"
							use:enhance={() =>
								async ({ result, update }) => {
									if (result.type === 'success') slipOpen = null;
									await update({ reset: false });
									if (result.type === 'success' && result.data?.slipped) {
										const sl = result.data.slipped as { id: string; habit: string };
										showToast(b.limit ? `Logged one for ${sl.habit}.` : `Slip logged for ${sl.habit}.`, undoWith('/?/unslip', { id: sl.id }));
									}
								}}
						>
							<input type="hidden" name="habit" value={b.habitId} />
							<div class="row">
								<label style="width: 5rem">Count <input name="count" type="number" min="1" max="1000" step="1" value="1" required /></label>
								<label class="grow"
									>Date <input name="date" type="date" value={data.today} min={b.startDate} max={data.today} required /></label
								>
								<label style="width: 7rem">Time <input name="time" type="time" value={nowTime()} /></label>
							</div>
							<div>
								<span class="muted small-text">How were you feeling? (optional)</span>
								<input type="hidden" name="feeling" value={feeling} />
								<div class="chips">
									{#each b.triggers as t (t.id)}
										<button type="button" class="toggle" aria-pressed={feeling === t.id} onclick={() => (feeling = feeling === t.id ? '' : t.id)}>{t.name}</button>
									{/each}
								</div>
							</div>
							<div class="row">
								<label class="grow">Where <input name="place" list="places-{b.habitId}" placeholder="optional" /></label>
								<label class="grow">With <input name="withWhom" placeholder="optional" /></label>
							</div>
							<datalist id="places-{b.habitId}">
								{#each b.places as p (p)}<option value={p}></option>{/each}
							</datalist>
							<button class="primary">{b.limit ? 'Log' : 'Log slip'}</button>
						</form>
				</div>
			{/if}
		{/snippet}
		{#snippet actions(b)}
			{#if !editing}
				<LogControl
					name={b.name}
					act={{ label: 'Resisted', action: '?/craving', fields: { habit: b.habitId }, submit: resisted }}
					ways={[{ label: b.limit ? 'Log one…' : 'Log a slip…', onselect: () => ((slipOpen = slipOpen === b.habitId ? null : b.habitId), (feeling = '')) }]}
				/>
			{/if}
		{/snippet}
	</EditableList>
{/snippet}

{#snippet prepSection()}
	{#if data.prep.length && !hidden('prep')}
		<ul class="list">
			{#each data.prep as p (p.habitId)}
				<li class="card">
					<strong>{p.name}</strong>
					{#each p.items as it (it.item)}
						<form method="POST" action="?/prep" use:enhance>
							<input type="hidden" name="habit" value={p.habitId} />
							<input type="hidden" name="item" value={it.item} />
							<input type="hidden" name="done" value={String(!it.done)} />
							<button class="check" class:done={it.done} aria-pressed={it.done}>
								<span class="box" aria-hidden="true">{it.done ? '✓' : ''}</span>{it.item}
							</button>
						</form>
					{/each}
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet pausedSection()}
	<EditableList items={data.paused} key={(x) => x.habitId} label={(x) => x.name} mode="use" rowCard ariaLabel="Paused">
		{#snippet row(item)}
			<span class="name">{item.name}</span>
			<p class="meta-line">Paused until {shortDate(item.pausedUntil!)}. Streak is safe.</p>
		{/snippet}
		{#snippet actions(item)}<a class="quiet hit" href="/habits/{item.habitId}#pause" aria-label="Change the pause of {item.name}">Change</a>{/snippet}
	</EditableList>
{/snippet}

{#snippet trackingSection()}
	<EditableList items={trackingShown} key={(x) => x.habitId} label={(x) => x.name} mode="use" rowCard ariaLabel="Tracking">
		{#snippet row(item)}
			<span class="name">{item.name}</span>
			{#if headlineOf(item, true)}<p class="meta-line">{headlineOf(item, true)}</p>{/if}
			{#if editing}{@render headlinePick(item)}{/if}
		{/snippet}
		{#snippet actions(item)}
			<a class="quiet hit" href="/q/{item.habitId}" data-sveltekit-preload-data="off" aria-label="Log {item.name}">Log</a>
		{/snippet}
	</EditableList>
{/snippet}

{#snippet restingSection()}
	<EditableList items={data.resting} key={(x) => x.habitId} label={(x) => x.name} mode="use" rowCard ariaLabel="Not due today">
		{#snippet row(item)}
			<span class="name">{item.name}</span>
			{#if item.streak}<p class="meta-line">{item.streak}</p>{/if}
		{/snippet}
		{#snippet actions(item)}
			{#if item.earlyVariant}
				<form method="POST" action="?/early" use:enhance>
					<input type="hidden" name="habit" value={item.habitId} />
					<input type="hidden" name="variant" value={item.earlyVariant.id} />
					<button class="quiet hit" aria-label="Start early: {item.multiVariant ? item.earlyVariant.name : item.name}">Start early</button>
				</form>
			{/if}
		{/snippet}
	</EditableList>
{/snippet}

{#if data.dayNote !== null}<DayNote date={data.today} text={data.dayNote} />{/if}

{#if form?.error && !form?.habit}<p class="error">{form.error}</p>{/if}

<style>
	.headline-pick {
		margin-top: 0.5rem;
	}
	.nudge {
		align-items: center;
		margin-bottom: 0.75rem;
		border-color: var(--accent);
	}
	:global(.elist > li.stacked) {
		margin-inline-start: var(--space-indent);
	}
	.slip {
		margin-top: 0.75rem;
	}
	.grow,
	.card strong {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		margin-top: 0.4rem;
		border: none;
		background: none;
		padding: 0.2rem 0;
		min-height: 2rem;
		text-align: left;
	}
	.check .box {
		width: 1.2rem;
		height: 1.2rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		display: inline-grid;
		place-items: center;
		font-size: var(--font-size-chip);
		color: var(--accent);
	}
	.check.done {
		color: var(--ink-muted);
		text-decoration: line-through;
	}
	/* Under the title: the date, which opens the last seven days, and the one count (TS.5). */
	.today-line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-inline);
	}
	.today-line .date {
		min-height: var(--target-min);
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.today-line .chev {
		display: inline-block;
		color: var(--ink);
		transition: rotate var(--duration-quick);
	}
	.today-line .date[aria-expanded='true'] .chev,
	.later-line[aria-expanded='true'] .chev,
	:global(.row-fold[aria-expanded='true'] .chev) {
		rotate: 90deg;
	}
	.today-line .num {
		color: var(--ink);
	}
	.today-strip {
		margin-block-end: var(--space-group);
	}
	/* One column on a phone; from 64rem Breaking and the end line stand beside the day (TS.11). */
	.today-cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}
	.today-side:not(:empty) {
		margin-block-start: var(--space-section);
	}
	/* The seven days as a block at the top of the side column: as wide as the column, one card. */
	.week-side {
		padding: var(--space-inline);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		background: var(--surface-raised);
	}
	@media (min-width: 64rem) {
		:global(.main:has(.today-cols)) {
			max-width: 1016px;
		}
		.today-cols {
			grid-template-columns: minmax(0, 640fr) minmax(0, 344fr);
			column-gap: calc(2 * var(--space-group));
			align-items: start;
		}
		.today-side:not(:empty) {
			margin-block-start: 0;
		}
	}
	.all-done {
		margin: var(--space-group) 0;
		font-weight: 600;
	}
	/* A row's ›: hangs in the card's padding before the name, and opens the row until the page is left (TS.4). */
	:global(.elist > li > .card:has(> .content > .row-fold)) {
		position: relative;
	}
	:global(.row-fold) {
		position: absolute;
		inset-inline-start: 0;
		top: calc(var(--space-group) - 1px);
		inline-size: var(--space-group);
		min-height: 1.5rem;
		padding: 0;
		border: 0;
		background: none;
		color: var(--ink-muted);
		cursor: pointer;
	}
	:global(.row-fold .chev) {
		display: inline-block;
		transition: rotate var(--duration-quick);
	}
	.later {
		margin-block-start: var(--space-group);
	}
	.later-line {
		display: flex;
		gap: var(--space-inline);
		align-items: baseline;
		min-height: var(--target-touch);
		padding: 0;
		border: 0;
		background: none;
		color: var(--ink-muted);
		font: inherit;
		font-size: var(--font-size-label);
		text-align: start;
		cursor: pointer;
	}
	.line-off > span {
		color: var(--ink-muted);
		text-decoration: line-through;
	}
	.line-verb {
		margin-inline-start: var(--space-inline);
	}
	@media (prefers-reduced-motion: reduce) {
		.today-line .chev,
		:global(.row-fold .chev) {
			transition: none;
		}
	}
</style>
