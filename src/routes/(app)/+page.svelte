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
	import { inMyOrder, ownNumber, sentence, todayWords } from '$lib/view-words';
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
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import GroupHeading from '$lib/ui/GroupHeading.svelte';
	import LogControl, { type Way } from '$lib/ui/LogControl.svelte';
	import StatusTag from '$lib/ui/StatusTag.svelte';
	import TitleLine from '$lib/ui/TitleLine.svelte';
	import { MediaQuery, SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { keepFocus, rowOf } from '$lib/ui/focus';
	import { mergeOrder } from '$lib/ui/list';
	import { cueClock } from '$lib/engine/day';
	import { timeline, type Slot } from '$lib/engine/stack';
	import { usualWay } from '$lib/log/usual';
	import DaysBlock from '$lib/days/DaysBlock.svelte';
	import { countedRows, statusCount } from '$lib/days/days';
	import {
		STARTERS,
		STATS,
		fromTemplate,
		groupBy,
		initialState,
		manualOrder,
		movedPart,
		partAt,
		passes,
		sameSide,
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
					// Due again before it loses its hold, so the row never leaves the list (focus stays its own).
					await invalidateAll();
					just.delete(habitId);
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
	let retired = $state<string[]>([]);
	function retire(id: HintId) {
		if (retired.includes(id)) return;
		const was = [...data.hints, ...retired.filter((h) => !data.hints.includes(h))];
		retired = [...retired, id];
		void fetch('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ set: { hints: [...was, id] }, was: { hints: was } }) }).catch(() => null);
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
	/** Rows opened with ›, until the page is left: an open row says it all, with its lines' Hide and Show and its Number. */
	const opened = new SvelteSet<string>();
	const rankOf = (id: string) => (opened.has(id) ? 3 : Math.max(RANK[view.rows], id === upNext && view.rows !== 'names' ? 2 : 0));
	/** A kind of line shows on a row: its feature is on, the view keeps it, and the row says that much. */
	const shows = (id: string, k: LineKey, r = rankOf(id)) => featureOn(k) && !view.hide.includes(k) && r >= NEED[k];
	/** An open row lists the hidden kinds too, each with its verb (TS.9). */
	const listed = (id: string, k: LineKey, open = opened.has(id)) => featureOn(k) && (open || shows(id, k));
	/** A tracker shows its last value unless it has a number of its own; its logs read "logged". */
	const headlineOf = (item: Item, tracker = false, r = rankOf(item.habitId)) => {
		if (!r) return ''; // names only, and the row not opened
		const kind = headlineKind(views.today.headlineFor[item.habitId], view.num, tracker);
		if (kind === 'none') return '';
		return data.headlines[item.habitId] ?? headlineText(kind, item.stats, item.streak, { last: item.last, tracker });
	};
	const LINE_SAID: Record<LineKey, string> = { cue: 'when and where', headline: 'the number', levels: 'the Minimum', bundle: 'treats', reframe: 'reframe lines', reward: 'jars and savings', identities: 'identities', progression: 'suggestions to raise' };
	/** Hide or show one kind of line in this view, from a row opened with ›. */
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

	const folded = (k: string) => views.today.folded.includes(foldKey(k));
	// Stored keys are short and few; a long group name folds by its start.
	const foldKey = (k: string) => k.slice(0, 64);
	const fold = (k: string) => setToday({ folded: toggleIn(views.today.folded, foldKey(k)).slice(-100) });
	/** A move, said once it is saved. */
	const moved = (patch: Partial<typeof views.today>, said: string, undo: () => Promise<boolean>) => void setToday(patch).then((ok) => ok && showToast(said, undo));
	/** The sentence reads "in my order", so the order you see is yours: each habit and tracker has its grip (MO). In any other order there is none; picking My order brings them back. */
	const gripped = $derived(inMyOrder(view));
	/** A list was reordered by its grips: it goes into the one habit order (My order), shared with the Habits page. */
	function reorderHabits(key: string, part: string[], said: string) {
		const was = views.today.order;
		const ids = [...data.build, ...data.tracking, ...data.breaking, ...data.paused, ...data.resting].map((b) => b.habitId);
		moved({ order: mergeOrder([...was, ...ids.filter((id) => !was.includes(id))], movedPart(part, key, sunk)) }, said, async () => !!(await setToday({ order: was })));
		return true;
	}
	/** A habit's own number, from its open row: said in the band, with the Undo that puts back this habit's number only, so numbers picked since stay. */
	function setHeadline(item: { habitId: string; name: string }, v: StatKey | '') {
		const was = views.today.headlineFor[item.habitId] ?? '';
		if (was === v) return;
		const { next, said } = ownNumber(views.today.headlineFor, item.habitId, item.name, v);
		moved({ headlineFor: next }, said, async () => !!(await setToday({ headlineFor: ownNumber(views.today.headlineFor, item.habitId, item.name, was).next })));
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
	/** Done habits sunk to the end of the list (done at the end), which a move puts back apart from the rest. */
	const sunk = $derived(new Set(view.done === 'bottom' ? shownBuild.filter(settled).map((b) => b.habitId) : []));
	/** A habit's time on the timeline: its cue's, or its anchor's when it is stacked after one. */
	const timeOf = (b: Item, depth = 0): { clock: string | null; label: string | null } => {
		const clock = cueClock(b.cue, data.ranges);
		if (clock) return { clock, label: b.cue.time ?? b.cue.range };
		const anchor = b.afterHabitId && depth < 8 ? data.build.find((x) => x.habitId === b.afterHabitId) : undefined;
		return anchor ? timeOf(anchor, depth + 1) : { clock: null, label: null };
	};
	/**
	 * By time with no groups: the day as a timeline, with a Now line (Today, option B). Done rows sunk to the end stay
	 * after it. Null when nothing has a time, so the list stays as it was.
	 */
	const tl = $derived.by(() => {
		if (view.sort !== 'cue' || view.group !== 'none') return null;
		const items = shownBuild
			.filter((b) => !sunk.has(b.habitId))
			.map((b) => {
				const kids = b.group && !b.group.routine ? kidsOf(b.habitId).map((k) => ({ id: k.habitId, ...timeOf(k) })) : undefined;
				// A routine is done in one go: it stands at its own time, else at its first habit's.
				const own = timeOf(b);
				const first = !own.clock && b.group?.routine ? kidsOf(b.habitId).map((k) => timeOf(k)).find((t) => t.clock) : undefined;
				return { ...b, id: b.habitId, ...(first ?? own), kids };
			});
		const t = timeline(items, now, data.dayStart);
		return t.past.length || t.ahead.length ? t : null;
	});
	/** The habits a group holds in one slot of the timeline: those at that time, or all of them. */
	const kidsIn = (s: Slot<Item> | undefined, id: string) => kidsOf(id).filter((k) => !s?.only.get(id) || s.only.get(id)!.has(k.habitId));
	/** The one row whose Log stands out: what is stacked on something done, or else the first one due. */
	const upNext = $derived.by(() => {
		const tops: [Item, Slot<Item> | undefined][] = tl ? [...tl.past, ...(tl.anyTime ? [tl.anyTime] : []), ...tl.ahead].flatMap((s) => s.items.map((b): [Item, Slot<Item>] => [b, s])) : shownBuild.map((b) => [b, undefined]);
		const due = tops.flatMap(([b, s]) => [b, ...kidsIn(s, b.habitId)]).filter((b) => !isDone(b) && !(b.group && !b.group.routine && kidsOf(b.habitId).length));
		return (due.find((b) => b.upNext) ?? due[0])?.habitId;
	});
	const areaOf = (id: string | null) => data.areas.find((a) => a.id === id);
	/** The habits a list stands for: a group or routine counts through the habits inside it, at any depth. */
	const leavesOf = (items: Item[]): Item[] => items.flatMap((b) => (b.group ? leavesOf(kidsOf(b.habitId)) : [b]));
	const groups = $derived(groupBy(shownBuild.map((b) => ({ ...b, part: partOf(b) })), view.group, { areas: data.areas, parts: partNames }));
	/** Break habits the view lets through: in My order too, which every habit shares with the Habits page. */
	const breakingShown = $derived.by(() => {
		if (view.direction === 'build') return [];
		const list = data.breaking.filter((b) => passes(view, { ...b, direction: 'break' }));
		return view.sort === 'manual' ? manualOrder(list, views.today.order, (b) => b.habitId) : list;
	});
	const pausedShown = $derived(view.sort === 'manual' ? manualOrder(data.paused, views.today.order, (b) => b.habitId) : data.paused);
	const restingShown = $derived(view.sort === 'manual' ? manualOrder(data.resting, views.today.order, (b) => b.habitId) : data.resting);
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
	// Counted as the days block and History count a day.
	const dueLeaves = $derived(countedRows(data.build));
	const doneCount = $derived(dueLeaves.filter(isDone).length);
	/** Everything due is done or skipped. */
	const allDone = $derived(dueLeaves.length > 0 && doneCount === dueLeaves.length && view.direction !== 'break');
	/** The view lets nothing through though there is something today. */
	const nothingShown = $derived(!shownBuild.length && !doneFolded.length && !breakingShown.length && !timeHidden.size && !allDone);

	// ----- The date opens the days block (TS.5) -----
	let strip = $state(false);
	/** From 64rem the side column holds the days block, always shown (TS.11). */
	const wide = new MediaQuery('min-width: 64rem');
	// One at a time, in the hint line: 'done' while something is due, then 'days' while the days block is on screen.
	const hint = $derived(hintNow([...data.hints, ...retired], [...(data.build.some((b) => b.occurrence?.status === 'due') ? ['done' as const] : []), ...(wide.current || strip ? ['days' as const] : [])]));
	/** Prepare for tomorrow, Paused and Not due today: at the end, each list under its own heading. */
	const later = $derived((data.prep.length > 0 && !hidden('prep')) || data.paused.length > 0 || data.resting.length > 0);

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
	/** "tomorrow, Nov 28", or the day and date further off ("Mon, Nov 30"): when a card that isn't for today is for. */
	const dueWhen = (d: string) =>
		d === addDays(data.today, 1) ? `tomorrow, ${new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : shortDate(d);
	const limiting = $derived(data.breaking.some((b) => b.limit));
	const nowTime = () => new Date().toTimeString().slice(0, 5);
	const levelName = { minimum: 'Minimum', target: 'Target', stretch: 'Stretch' } as const;

	type Item = (typeof data.build)[number];
	const cueLine = (c: Item['cue']) =>
		[c.after ? `after ${c.after}` : null, c.time ?? c.range, c.place].filter(Boolean).join(' · ');
	const meta = (item: Item, r = rankOf(item.habitId)) => {
		const o = item.occurrence!;
		const st = item.group ? groupNow(item).status : statusOf(o);
		const g = item.group ? groupNow(item) : null;
		const open = r >= 2;
		const says = r >= 1;
		return [
			open && view.group !== 'area' ? areaOf(item.areaId)?.name : null,
			st === 'due' && item.inProgress ? 'In progress' : null,
			says && item.multiVariant ? o.variantName : null,
			g?.total ? rollupText(g) : null,
			says && item.progress && st !== 'skipped' && (st === 'due' || isPartial(item.progress)) ? progressText(item.progress) : null,
			shows(item.habitId, 'cue', r) ? cueLine(item.cue) : says ? (item.cue.time ?? item.cue.range) : null,
			headlineOf(item, false, r)
		]
			.filter(Boolean)
			.join(' · ');
	};
	/** The lines under a row's meta, as much as the view and the row say (TS.4); an open row lists the hidden kinds too (listed). */
	const rowLines = (item: Item, st: string, open = opened.has(item.habitId)) => {
		const o = item.occurrence!;
		const out: { k: LineKey; text: string }[] = [];
		if (item.levels?.minimum && st === 'due') out.push({ k: 'levels', text: `Minimum: ${item.levels.minimum}` });
		if (item.bundle) out.push({ k: 'bundle', text: `${item.bundle.strict ? (o.status === 'done' ? 'Earned' : 'After this') : 'Pair with'}: ${item.bundle.reward}` });
		if (item.reframe) out.push({ k: 'reframe', text: item.reframe });
		if (item.reward?.jar) out.push({ k: 'reward', text: `Jar: ${fmt(item.reward.jar.total)} ${item.reward.jar.unit}${item.reward.jar.goal ? ` toward ${item.reward.jar.goal}` : ''}` });
		if (item.identities.length) out.push({ k: 'identities', text: item.identities.join(' · ') });
		return out.filter((l) => listed(item.habitId, l.k, open));
	};
	/**
	 * Opening the row changes it, so it has a ›. A habit's open row has its Number; a group or routine has none, so it opens
	 * only when it would then list a line with its Hide or Show, or say more than it does now.
	 */
	const opens = (item: Item, st: string) =>
		!item.group ||
		opened.has(item.habitId) ||
		rowLines(item, st, true).length > 0 ||
		(!!item.progression && st === 'due' && featureOn('progression')) ||
		meta(item, 3) !== meta(item);
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

<!-- No second state: Today keeps its own ⋯ and, under the title, the date (which opens the days block) and the count. -->
{#snippet dayLine()}
	<span class="today-line">
		{#if wide.current}<span class="date">{dateLabel}</span>{:else}<button type="button" class="date" aria-expanded={strip} aria-controls="today-strip" onclick={() => (strip = !strip)}>{dateLabel} <span class="chev" aria-hidden="true">›</span></button>{/if}
		<span class="num">{doneCount} of {dueLeaves.length} done</span>
	</span>
{/snippet}
<TitleLine title="Today" hint={dayLine}>
	{#snippet actions()}
		{#if data.canBackfill || !hidden('identities')}
			<MenuButton
				class="button"
				label="More on Today"
				items={[...(data.canBackfill ? [{ label: 'Log a past day', href: '/day' }] : []), ...(!hidden('identities') ? [{ label: 'Identities', href: '/identities' }] : [])]}
			/>
		{/if}
	{/snippet}
</TitleLine>

{#if strip && !wide.current}
	<div class="today-strip" id="today-strip">{@render days()}</div>
{/if}

{#snippet days()}
	<!-- Today as the server counts a day (a skip is neither done nor due), with what was just pressed. -->
	<DaysBlock {...data.block} todayCount={statusCount(dueLeaves.map((b) => statusOf(b.occurrence!)))} href={(d) => (d < data.today ? `/day/${d}` : null)} onused={() => retire('days')} slotOpen={gripped && wide.current} />
{/snippet}

{#if data.askDay}
	<div class="notice" role="note">
		<span class="notice-text">It is past midnight. Is it still {yesterdayName} for you? What you log now counts for that day then.{#if problem} <span class="error">{problem}</span>{/if}</span>
		<span class="notice-acts"><button type="button" class="quiet" onclick={() => startDay('04:00')}>Yes, until 04:00</button><button type="button" class="quiet" onclick={() => startDay('00:00')}>No, days start at midnight</button></span>
	</div>
{/if}

{#if notDue}
	<div class="notice" role="status">
		<span class="notice-text">{notDue.text}</span>
		<span class="notice-acts">{#if notDue.habit}<a class="quiet" href="/q/{notDue.habit}?go=1&extra=1" data-sveltekit-preload-data="off" onclick={() => (notDue = null)}>Log it anyway</a>{/if}<button type="button" class="quiet" onclick={() => (notDue = null)}>Close</button></span>
	</div>
{/if}

{#if data.unlogged.length && nudgeHiddenFor !== yesterday}
	<div class="notice nudge" role="status">
		<span class="notice-text"
			>Yesterday {data.unlogged.length === 1 ? 'one habit was' : `${data.unlogged.length} habits were`} not logged: {data.unlogged
				.slice(0, 3)
				.join(', ')}{data.unlogged.length > 3 ? ' and more' : ''}. Did you do {data.unlogged.length === 1 ? 'it' : 'them'}?</span
		>
		<span class="notice-acts"><a class="quiet" href="/day/{yesterday}">Log yesterday</a><button type="button" class="quiet" onclick={hideNudge} aria-label="Hide this until tomorrow">Hide</button></span>
	</div>
{/if}

{#if !data.build.length && !data.tracking.length && !data.resting.length && !data.breaking.length && !data.paused.length}
	<Box hint="Write it as you would say it: what, how much, how often. Anything you can count or do." />
	<section class="ob-sec" aria-label="Or start from">
		<p class="meta muted">Or start from</p>
		<div class="chips">
			{#each PACKS.filter((p) => !data.packs.includes(p.id)) as p (p.id)}<button type="button" class="toggle" onclick={() => packIn(p.id, p.name)}>{p.name}</button>{/each}
		</div>
		<div class="l-cluster"><a class="button" href="/gallery">Gallery</a><a class="button" href="/habits/import">Add a file</a><a class="quiet" href="/habits/new">Step by step</a></div>
	</section>
{:else}
	<ViewSentence bind:this={sentenceBar} page="today" bind:views bind:current={view} {words} starters={STARTERS()} reset={fromTemplate(views.template).defaults.today} say={(s) => sentence(todayWords(s, wordsCtx))} />
	{#if hint}
		<div class="notice ob-hint" role="note"><span class="notice-text">{HINTS[hint]}</span><span class="notice-acts"><button type="button" class="quiet" onclick={() => hint && retire(hint)}>Got it</button></span></div>
	{/if}

	<div class="page-cols">
		<div class="today-day">
			{#if view.first && breakingShown.length}{@render breaking()}{/if}
			<!-- Beside Breaking, the day takes a heading of the same kind, so both columns start alike (TS.11). -->
			{#if wide.current && !view.first && groups.length && !groups[0].label}<GroupHeading title="Due today" slotOpen={gripped} foldColumn />{/if}
			{#if allDone}<p class="all-done">Everything due today is done.</p>{/if}
			{#if nothingShown}<EmptyState kind="filtered" text="Nothing today matches {words[0].shown ?? 'this view'}." onclear={() => sentenceBar?.change({ ...view, fits: false, status: 'all', direction: 'all', areas: [], identity: null }, 'now shows everything', 'Everything')} />{/if}
			{#if tl}
				<!-- By time: each time once, in the gutter, and a Now line between what is past and what is ahead. -->
				<ol class="timeline" aria-label="Today by time">
					{#each tl.past as s (s.key)}{@render slot(s)}{/each}
					<li class="now-line"><span class="when num">{now}</span><span class="now">Now</span></li>
					{#if tl.anyTime}{@render slot(tl.anyTime)}{/if}
					{#each tl.ahead as s (s.key)}{@render slot(s)}{/each}
					<!-- Done at the end: on the timeline's column too, under its own word. -->
					{#if sunk.size}
						<li class="slot">
							<span class="when">Done</span>
							<div class="slot-rows">{@render habitList(shownBuild.filter((b) => sunk.has(b.habitId)), 'Done today')}</div>
						</li>
					{/if}
				</ol>
			{:else}
				{#each groups as g (g.key)}
					{@const a = view.group === 'area' ? areaOf(g.key) : undefined}
					{#if g.label}
						<GroupHeading title={a?.name ?? g.label} icon={a?.icon} color={g.color} folded={folded(`group:${g.key}`)} onfold={() => fold(`group:${g.key}`)} />
					{/if}
					{#if !g.label || !folded(`group:${g.key}`)}{@render habitList(g.items, g.label || 'Today')}{/if}
				{/each}
			{/if}
			{@render timeLine()}
			{#if doneFolded.length}
				<GroupHeading title="Done" slotOpen={gripped} count={String(leavesOf(doneFolded).length)} folded={folded('done')} onfold={() => fold('done')} />
				{#if !folded('done')}{@render habitList(doneFolded, 'Done today')}{/if}
			{/if}
		</div>
		<div class="today-side">
			{#if wide.current}
				{@render days()}
			{/if}
			{#if !view.first && breakingShown.length}{@render breaking()}{/if}
			{#if trackingShown.length}
				<!-- Trackers keep what you log: never due or missed, so they sit beside the day, not in it. -->
				<GroupHeading title="Tracking" slotOpen={gripped} count={String(trackingShown.length)} folded={folded('tracking')} onfold={() => fold('tracking')} />
				{#if !folded('tracking')}{@render trackingSection()}{/if}
			{/if}
			{#if later && view.direction === 'all' && !view.fits}
				<section class="later" aria-label="Later and not today">
					{@render prepSection()}
					{#if data.paused.length}<h3 class="card-title later-head">Paused</h3>{@render pausedSection()}{/if}
					{#if data.resting.length}<h3 class="card-title later-head">Not due today</h3>{@render restingSection()}{/if}
				</section>
			{/if}
		</div>
	</div>
{/if}

{#if data.habitCount > 0 && data.habitCount < 3}
	<section class="ob-sec" aria-label="Another habit"><Box question="What else do you want to track?" /></section>
{/if}

{#snippet breaking()}
	<GroupHeading title={limiting ? 'Breaking and limiting' : 'Breaking'} slotOpen={gripped} foldColumn />
	{@render breakingSection()}
{/snippet}

<!-- A row's ›, after its name: it opens the row until the page is left (TS.4). A habit's and a tracker's always shows,
     since an open row holds its lines' Hide and Show and its Number; a group's or routine's only when opening it changes
     the row (opens); a Breaking row's only while the row says less than all. -->
{#snippet fold1(id: string, name: string, always: boolean)}
	{#if always || opened.has(id) || rankOf(id) < 3}
		<button type="button" class="fold row-fold" aria-expanded={opened.has(id)} aria-label="{opened.has(id) ? 'Less' : 'More'} about {name}" onclick={() => (opened.has(id) ? opened.delete(id) : opened.add(id))}><span class="chev" aria-hidden="true">›</span></button>
	{/if}
{/snippet}

<!-- An open row's Number: the habit's own number instead of the view's, a ruled word as the sentence's are. -->
{#snippet numberWord(item: { habitId: string; name: string }, tracker: boolean)}
	{@const own = views.today.headlineFor[item.habitId]}
	{@const usual = tracker ? 'last' : view.num}
	{@const shown = STATS[own ?? usual]}
	<p class="meta">
		<span>Number</span>
		<span class="number-word"
			><MenuButton
				class="word-button"
				label="Number on {item.name}: {shown}"
				menuLabel="Number on {item.name}"
				items={[
					{ label: "This view's", value: STATS[usual], checked: !own, onselect: () => setHeadline(item, '') },
					'-',
					...(Object.keys(STATS) as StatKey[]).map((k) => ({ label: STATS[k], checked: own === k, onselect: () => setHeadline(item, k) }))
				]}
				>{#snippet trigger()}<span class="shown">{shown.toLowerCase()}</span>{/snippet}</MenuButton
			></span
		>
	</p>
{/snippet}

{#snippet slot(s: Slot<Item>)}
	<li class="slot">
		<span class="when num">{s.label ?? 'Any time'}</span>
		<div class="slot-rows">{@render habitList(s.items, s.label ?? 'Any time', s)}</div>
	</li>
{/snippet}

{#snippet habitList(items: Item[], name: string, s?: Slot<Item>)}
	<EditableList
		{items}
		key={(b) => b.habitId}
		label={(b) => b.name}
		rowCard
		holder={(b) => !!b.group && kidsOf(b.habitId).length > 0}
		itemClass={(b) => [isDone(b) && statusOf(b.occurrence!) === 'skipped' ? 'skipped' : isDone(b) ? 'done' : '', just.has(b.habitId) ? 'just-done' : '', b.afterHabitId && view.group !== 'area' && (!s || s.items.some((x) => x.habitId === b.afterHabitId)) ? 'stacked' : ''].join(' ')}
		ariaLabel={name}
		canDrop={(m) => sameSide(sunk, m)}
		onmove={gripped ? (m, order, text) => reorderHabits(m.key, order, text) : undefined}
		actions={verb}
		lines={habitLines}
	>
		{#snippet row(item)}{@render habitRow(item)}{/snippet}
		{#snippet children(item)}{@render habitList(kidsIn(s, item.habitId), `Inside ${item.name}`)}{/snippet}
	</EditableList>
{/snippet}

{#snippet habitRow(item: Item)}
	{@const o = item.occurrence!}
	{@const st = item.group ? groupNow(item).status : statusOf(o)}
	{@const done = ended(item)}
	<a class="name" href="/habits/{item.habitId}/chain">{item.name}</a>
	{#if opens(item, st)}{@render fold1(item.habitId, item.name, true)}{/if}
	{#if item.habitId === upNext || (item.progression && featureOn('progression') && !view.hide.includes('progression') && !shows(item.habitId, 'progression') && st === 'due')}
		<span class="tags">{#if item.habitId === upNext}<StatusTag status="upNext" />{/if}{#if item.progression && featureOn('progression') && !view.hide.includes('progression') && !shows(item.habitId, 'progression') && st === 'due'}<span class="tag">Raise?</span>{/if}</span>
	{/if}
	{#if done || meta(item)}
		<p class="meta-line">
			{#if done}<span class="mark" aria-hidden="true">{st === 'skipped' ? '↷' : '✓'}</span> {done}{#if just.get(item.habitId)?.words}{' · '}{just.get(item.habitId)?.words}{/if}{meta(item) ? ' · ' : ''}{/if}{meta(item)}
		</p>
	{/if}
{/snippet}

<!-- What hangs under a row's name and meta: its own line in the card, so the verb centres on the name and meta. -->
{#snippet habitLines(item: Item)}
	{@const st = item.group ? groupNow(item).status : statusOf(item.occurrence!)}
	{@const open = opened.has(item.habitId)}
	{@const lines = rowLines(item, st)}
	{#if item.atRisk && st === 'due'}<p class="row-line warn meta">You missed last time. Don't miss twice{item.levels ? ': even the Minimum counts' : ''}.</p>{/if}
	{#if open && (lines.length || !item.group)}
		<!-- Open: each kind of line with Hide or Show (a hidden one struck), then the Number. Each changes this view, with Undo. -->
		<div class="row-line open-lines">
			{#each lines as l (l.k)}
				{@const off = view.hide.includes(l.k)}
				<p class="meta" class:line-off={off}>
					<span>{l.text}</span><button type="button" class="quiet" aria-label="{off ? 'Show' : 'Hide'} {LINE_SAID[l.k]} in this view" onclick={() => flipLine(l.k)}>{off ? 'Show' : 'Hide'}</button>
				</p>
			{/each}
			{#if !item.group}{@render numberWord(item, false)}{/if}
		</div>
	{:else}
		{#each lines as l (l.k)}<p class="row-line meta">{l.text}</p>{/each}
	{/if}
	{#if item.progression && st === 'due' && listed(item.habitId, 'progression')}
		{@const p = item.progression}
		{@const off = view.hide.includes('progression')}
		<div class="notice" class:line-off={off}>
			<span class="notice-text meta"
				>You've hit your targets {p.hits} times in a row. Raise them by {p.by}{p.unit === 'percent' ? '%' : p.by === 1 ? ' step' : ' steps'}? {p.changes.join(' · ')}</span
			>
			<span class="notice-acts">
				{#if !off}
					<form method="POST" action="?/raise" use:enhance><input type="hidden" name="habit" value={item.habitId} /><button class="quiet" aria-label="Raise the targets of {item.name}">Raise</button></form>
					<form method="POST" action="?/notYet" use:enhance><input type="hidden" name="habit" value={item.habitId} /><button class="quiet" aria-label="Not yet for {item.name}">Not yet</button></form>
				{/if}
				{#if open}<button type="button" class="quiet" aria-label="{off ? 'Show' : 'Hide'} {LINE_SAID.progression} in this view" onclick={() => flipLine('progression')}>{off ? 'Show' : 'Hide'}</button>{/if}
			</span>
		</div>
	{/if}
	{#if form?.raised === item.habitId}<p class="row-line meta">Targets raised. Keep going.</p>{/if}
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
		{#if item.group || o.slotCount > 0}<a class="quiet" href="/log/{o.id}" aria-label="View {item.name}">View</a>{/if}
		{@const undo = just.get(item.habitId)?.undo}
		{#if undo}
			<button type="button" class="quiet" aria-label="Undo {item.name}" onclick={undo}>Undo</button>
		{:else if !undoShows(band.entries, o.id) && (!item.group || item.group.undoable)}
			<!-- One Undo at a time: the band's while its line is this one, else the row's (after a reload too).
			     A routine done only through the habits inside it has nothing of its own to undo. -->
			<form method="POST" action="?/undo" use:enhance={() => async ({ result, update }) => { await update(); if (result.type === 'success') reopened(item); }}>
				<input type="hidden" name="occurrence" value={o.id} />
				<button class="quiet" aria-label="Undo {item.name}">Undo</button>
			</form>
		{/if}
	{/if}
{/snippet}

{#snippet timeLine()}
	{#if timeHidden.size}
		<p class="muted meta">
			Showing what fits {currentPart}. <button class="link" onclick={() => (showAll = true)}>Show all ({timeHidden.size} more)</button>
		</p>
	{:else if showAll && view.fits}
		<p class="muted meta"><button class="link" onclick={() => (showAll = false)}>Only show what fits now</button></p>
	{/if}
{/snippet}

{#snippet breakingSection()}
	<EditableList items={breakingShown} key={(b) => b.habitId} label={(b) => b.name} rowCard ariaLabel={limiting ? 'Limits' : 'Breaking'} onmove={gripped ? (m, order, text) => reorderHabits(m.key, order, text) : undefined}>
		{#snippet row(b)}
			<a class="name" href="/habits/{b.habitId}/chain">{b.name}</a>
			{@render fold1(b.habitId, b.name, false)}
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
		{/snippet}
		{#snippet lines(b)}
			{@const plan = b.ifThen}
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
								<label>Count <input class="w-num" name="count" type="number" min="1" max="1000" step="1" value="1" required /></label>
								<label class="grow"
									>Date <input name="date" type="date" value={data.today} min={b.startDate} max={data.today} required /></label
								>
								<label>Time <input class="w-time" name="time" type="time" value={nowTime()} /></label>
							</div>
							<div>
								<span class="muted meta">How were you feeling? (optional)</span>
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
							<button>{b.limit ? 'Log' : 'Log slip'}</button>
						</form>
				</div>
			{/if}
		{/snippet}
		{#snippet actions(b)}
			<LogControl
				name={b.name}
				act={{ label: 'Resisted', action: '?/craving', fields: { habit: b.habitId }, submit: resisted }}
				ways={[{ label: b.limit ? 'Log one…' : 'Log a slip…', onselect: () => ((slipOpen = slipOpen === b.habitId ? null : b.habitId), (feeling = '')) }]}
			/>
		{/snippet}
	</EditableList>
{/snippet}

{#snippet prepSection()}
	{#if data.prep.length && !hidden('prep')}
		<h3 class="card-title later-head">Prepare for tomorrow</h3>
		<ul class="list">
			{#each data.prep as p (p.habitId)}
				<li class="card">
					<strong>{p.name}</strong>
					<p class="meta-line">For {dueWhen(p.date)}</p>
					{#each p.items as it (it.item)}
						<form method="POST" action="?/prep" use:enhance={() => async ({ update }) => update({ reset: false })}>
							<input type="hidden" name="habit" value={p.habitId} />
							<input type="hidden" name="item" value={it.item} />
							<!-- Checkbox's tick: a change posts the box's own state, so what is sent is what is shown. No reset: it would
							     untick the box until the reload lands. -->
							<label class="check"><input type="checkbox" class="tick" name="done" value="true" checked={it.done} onchange={(e) => e.currentTarget.form?.requestSubmit()} /> {it.item}</label>
						</form>
					{/each}
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet pausedSection()}
	<EditableList items={pausedShown} key={(x) => x.habitId} label={(x) => x.name} rowCard ariaLabel="Paused" onmove={gripped ? (m, order, text) => reorderHabits(m.key, order, text) : undefined}>
		{#snippet row(item)}
			<span class="name">{item.name}</span>
			<p class="meta-line">Paused until {shortDate(item.pausedUntil!)}. Streak is safe.</p>
		{/snippet}
		{#snippet actions(item)}<a class="quiet" href="/habits/{item.habitId}#pause" aria-label="Change the pause of {item.name}">Change</a>{/snippet}
	</EditableList>
{/snippet}

{#snippet trackingSection()}
	<EditableList items={trackingShown} key={(x) => x.habitId} label={(x) => x.name} rowCard ariaLabel="Tracking" onmove={gripped ? (m, order, text) => reorderHabits(m.key, order, text) : undefined}>
		{#snippet row(item)}
			<span class="name">{item.name}</span>
			{@render fold1(item.habitId, item.name, true)}
			{#if headlineOf(item, true)}<p class="meta-line">{headlineOf(item, true)}</p>{/if}
		{/snippet}
		{#snippet lines(item)}
			{#if opened.has(item.habitId)}<div class="row-line open-lines">{@render numberWord(item, true)}</div>{/if}
		{/snippet}
		{#snippet actions(item)}
			<a class="quiet" href="/q/{item.habitId}" data-sveltekit-preload-data="off" aria-label="Log {item.name}">Log</a>
		{/snippet}
	</EditableList>
{/snippet}

{#snippet restingSection()}
	<EditableList items={restingShown} key={(x) => x.habitId} label={(x) => x.name} rowCard ariaLabel="Not due today" onmove={gripped ? (m, order, text) => reorderHabits(m.key, order, text) : undefined}>
		{#snippet row(item)}
			<span class="name">{item.name}</span>
			{#if item.nextDue || item.streak}<p class="meta-line">{[item.nextDue ? `Due ${dueWhen(item.nextDue)}` : '', item.streak].filter(Boolean).join(' · ')}</p>{/if}
		{/snippet}
		{#snippet actions(item)}
			{#if item.earlyVariant}
				<form method="POST" action="?/early" use:enhance>
					<input type="hidden" name="habit" value={item.habitId} />
					<input type="hidden" name="variant" value={item.earlyVariant.id} />
					<button class="quiet" aria-label="Start early: {item.multiVariant ? item.earlyVariant.name : item.name}">Start early</button>
				</form>
			{/if}
		{/snippet}
	</EditableList>
{/snippet}

{#if data.dayNote !== null}<DayNote date={data.today} text={data.dayNote} />{/if}

{#if form?.error && !form?.habit}<p class="error">{form.error}</p>{/if}

<style>
	.nudge {
		margin-bottom: var(--space-group);
	}
	:global(.elist > li.stacked) {
		margin-inline-start: var(--space-indent);
	}
	.slip {
		margin-top: var(--space-group);
	}
	.grow,
	.card strong {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	/* Under the title: the date, which opens the days block, and the one count (TS.5). */
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
	.today-line .date[aria-expanded='true'] .chev {
		rotate: 90deg;
	}
	.today-line .num {
		color: var(--ink);
	}
	.today-strip {
		margin-block-end: var(--space-group);
	}
	/* PageFrame's .page-cols: one column on a phone; from 64rem Breaking and the end line stand beside the day (TS.11). On
	   a phone the side column comes under the day, a section below it. */
	.today-side:not(:empty) {
		margin-block-start: var(--space-section);
	}
	@media (min-width: 64rem) {
		.today-side:not(:empty) {
			margin-block-start: 0;
		}
	}
	.all-done {
		margin: var(--space-group) 0;
		font-weight: 600;
	}
	/* A row's ›: Disclosure's fold on the name line, right after the name, so the leading slot stays the grip's (TS.4). A
	   24px box with the chevron in its middle; under a coarse pointer it grows to 44px tall, never wider, so it takes no
	   taps from the name beside it. The ::before is Disclosure's focus ring, so the growth is the ::after. */
	.row-fold {
		--fold-w: max(var(--target-min), var(--space-inline));
		position: relative;
		flex: none;
		width: var(--fold-w);
		min-height: var(--target-min);
		justify-content: center;
		color: var(--ink-muted);
		cursor: pointer;
	}
	/* The name leaves room for the › (its box and the gap before it), so the › never takes a flex line of its own: a long
	   name wraps within that width, and the › stays on its first line. */
	.name:has(+ .row-fold) {
		max-width: calc(100% - var(--target-min) - var(--space-inline));
	}
	@media (pointer: coarse) {
		.row-fold::after {
			content: '';
			position: absolute;
			inset-inline: 0;
			inset-block: calc((100% - var(--target-touch)) / 2);
		}
	}
	/* An open row's lines and its Number: one inset under the meta, each line's verb at its end (TS.9). On a shelf (a row
	   inside a group), which is sunken already, the inset is raised instead. */
	.open-lines {
		display: flex;
		flex-direction: column;
		gap: var(--space-tight);
		margin-block-start: var(--space-inline);
		padding: var(--space-inline) var(--space-group);
		border-radius: var(--radius-inset);
		background: var(--surface-sunken);
	}
	:global(.shelf) .open-lines {
		background: var(--surface-raised);
	}
	.open-lines > p {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-inline);
		margin: 0;
	}
	/* A narrow row (a phone) wraps the line's words, never its verb's. */
	.open-lines > p > .quiet {
		flex: none;
		margin-inline-end: calc(-1 * var(--space-tight)); /* the verb's words on the inset's edge, as a row's verb on its card's */
	}
	/* Under a coarse pointer a verb's hit area is its line and half the gap each side, not Button's 44px: the lines are
	   28px apart, so a taller area would take taps inside the next line's verb (as the sentence's ruled words do). */
	@media (pointer: coarse) {
		.open-lines > p > .quiet::before,
		.number-word > :global(.word-button)::before {
			inset-block: calc(-1 * var(--space-tight) / 2);
		}
	}
	/* The Number word: ruled, as the sentence's words are (ViewSentence); its menu hangs from it. */
	.number-word {
		position: relative;
		display: inline-flex;
	}
	.number-word :global(.word-button) {
		min-height: var(--target-min);
		padding: 0;
		border: 0;
		background: none;
		color: var(--ink);
		font: inherit;
		cursor: pointer;
	}
	.number-word :global(.shown) {
		border-bottom: 1px dashed var(--line-control);
	}
	@media (hover: hover) {
		.number-word :global(.word-button:hover .shown) {
			border-bottom-color: var(--ink);
		}
	}
	/* Each list at the end has its heading, on the cards' name column, so its cards never run into the next list's. */
	.later-head {
		margin: var(--space-section) 0 var(--space-inline);
		padding-inline: var(--space-group);
	}
	/* By time: each time once, in a gutter on its rows' first line, and a Now line between what is past and what is ahead. */
	.timeline {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		column-gap: var(--space-group);
		row-gap: var(--space-inline);
	}
	.timeline > li {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: subgrid;
		align-items: start;
	}
	/* On its first row's name line: below the card's edge and padding, in the name's line height (the body's). */
	.timeline .when {
		padding-block-start: var(--space-group);
		font-size: var(--font-size-meta);
		text-align: end;
		color: var(--ink-muted);
	}
	.timeline > .now-line {
		align-items: center;
		padding-block: var(--space-inline);
	}
	.timeline .now-line > span {
		padding-block-start: 0;
		color: var(--ink);
		font-weight: 600;
	}
	.now-line .now {
		font-size: var(--font-size-meta);
		display: flex;
		align-items: center;
		gap: var(--space-inline);
	}
	.now-line .now::after {
		content: '';
		flex: 1;
		border-block-start: var(--chosen-width) solid var(--line-chosen);
	}
	/* A phone keeps the cards' width: the time goes over its rows, on their name column. */
	@media (max-width: 28rem) {
		.timeline {
			grid-template-columns: minmax(0, 1fr);
		}
		.timeline .when {
			padding-block-start: 0;
			padding-inline-start: var(--space-group);
			text-align: start;
		}
		.timeline > .now-line {
			display: flex;
			align-items: center;
			gap: var(--space-inline);
		}
		.now-line .now {
			flex: 1;
		}
	}
	/* A kind of line this view hides, in an open row: struck. On the card the words are muted too; in the inset (sunken,
	   where nothing muted sits) they stay ink. */
	.line-off > span:not(.notice-acts) {
		text-decoration: line-through;
	}
	.notice.line-off > span:not(.notice-acts) {
		color: var(--ink-muted);
	}
	@media (prefers-reduced-motion: reduce) {
		.today-line .chev {
			transition: none;
		}
	}
</style>
