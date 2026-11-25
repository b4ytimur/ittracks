<script lang="ts">
	import { enhance } from '$app/forms';
	import { queueable } from '$lib/queueable';
	import { dismiss, hold, release, showError, showToast, undoWith } from '$lib/toast.svelte';
	import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { outbox } from '$lib/outbox.svelte';
	import ViewBar from '$lib/ViewBar.svelte';
	import { rememberLast, saveLayout, viewOp } from '$lib/viewclient';
	import { headlineText } from '$lib/engine/stats';
	import { isPartial, progressText } from '$lib/engine/progress';
	import { rollupDay, rollupText } from '$lib/engine/rollup';
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
	import { SvelteMap } from 'svelte/reactivity';
	import { reorderFrom, type Mode } from '$lib/ui/list';
	import {
		DONE_MODES,
		LAYOUTS,
		LINES,
		SECTIONS,
		STATS,
		TODAY_STATUSES,
		WIDGETS,
		fromTemplate,
		groupBy,
		initialState,
		manualOrder,
		partAt,
		passes,
		sectionOrder,
		type FeatureKey,
		type LayoutKey,
		type LineKey,
		type SectionKey,
		type StatKey,
		type WidgetKey
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
			else showToast(f.text, f.kind === 'did' && f.occurrence ? undoWith('/?/undo', { occurrence: f.occurrence, clear: f.clear ? '1' : '' }) : undefined);
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
		else if (item) showToast(`Logged ${item.name}.`, undoWith('/?/undo', { occurrence: id, clear: clear ? '1' : '' }));
		const u = new URL(page.url);
		u.searchParams.delete('did');
		u.searchParams.delete('clear');
		u.searchParams.delete('short');
		replaceState(u, {});
	});

	type Did = { occurrence: string; habit: string; clear: boolean; skipped?: boolean; short?: 'minimum' | 'target' };
	/** After a quick action: say what happened and offer Undo. */
	function afterDid(result: ActionResult) {
		if (result.type !== 'success') return;
		const did = result.data?.did as Did | undefined;
		if (!did) return;
		const undo = undoWith('/?/undo', { occurrence: did.occurrence, clear: did.clear ? '1' : '' });
		// Short of what counts for this habit: it stays open, and says why.
		if (did.short)
			showToast(
				`Logged ${did.habit}. It counts once it reaches ${did.short === 'target' ? 'the full target' : 'the Minimum'}, and stays open until the day ends.`,
				undo
			);
		else {
			const entry = showToast(`${did.skipped ? 'Skipped' : 'Logged'} ${did.habit}.`, undo);
			const item = data.build.find((b) => b.occurrence?.id === did.occurrence);
			if (item && !did.skipped) celebrate(item.habitId, entry, undo);
		}
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
				const p = result.data?.plus as { value: number; target: number; unit: string; done: boolean } | undefined;
				if (!p) return;
				const n = (x: number) => String(Math.round(x * 100) / 100);
				showToast(`${name}: ${n(p.value)} of ${n(p.target)}${p.unit ? ` ${p.unit}` : ''}${p.done ? '. Done!' : '.'}`, undoWith('/?/plus', { occurrence: occurrenceId, by: '-1' }));
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

	// ----- Views: filter, sort, group and layout, all saved per user -----
	let views = $state(untrack(() => data.views));
	let view = $state(untrack(() => initialState(data.views, 'today')));
	const featureOf: Partial<Record<LineKey, FeatureKey>> = {
		levels: 'levels',
		reframe: 'reframe',
		bundle: 'rewards',
		reward: 'rewards',
		progression: 'progression',
		identities: 'identities'
	};
	const hidden = (f: FeatureKey) => views.hidden.includes(f);
	const line = (k: LineKey) => views.today.lines.includes(k) && !(featureOf[k] && hidden(featureOf[k]!));
	const headlineOf = (item: Item) =>
		line('headline') ? (data.headlines[item.habitId] ?? headlineText(views.today.headlineFor[item.habitId] ?? views.today.headline, item.stats, item.streak)) : '';

	/** Change a Today layout setting here at once, and save it. */
	function setToday(patch: Partial<typeof views.today>): Promise<unknown> {
		const before = views.today;
		views.today = { ...views.today, ...patch };
		return saveLayout({ op: 'patch', today: patch }, () => (views.today = before), () => void setToday(patch));
	}
	const sections = $derived(sectionOrder(views));
	const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

	// ----- Edit mode: the same page, with widgets, sections and habits to drag, hide and show -----
	let mode = $state<Mode>('use');
	const editing = $derived(mode === 'edit');
	const layout = $derived(view.layout);
	function setLayout(to: LayoutKey) {
		const was = view.layout;
		view.layout = to;
		showToast(`Today now uses ${LAYOUTS[to]}.`, () => {
			view.layout = was;
			// Pressed on another page, nothing here watches the view any more.
			rememberLast('today', $state.snapshot(view));
		});
	}
	const template = $derived(fromTemplate(views.template).today);
	const atDefault = $derived(
		(['sections', 'done', 'widgets', 'lines', 'timeAware', 'headline'] as const).every((k) => JSON.stringify(views.today[k]) === JSON.stringify(template[k]))
	);
	function resetLayout() {
		const { sections, done, widgets, lines, timeAware, headline } = views.today;
		setToday({ sections: template.sections, done: template.done, widgets: template.widgets, lines: template.lines, timeAware: template.timeAware, headline: template.headline });
		showToast('Layout reset.', async () => !!(await setToday({ sections, done, widgets, lines, timeAware, headline })));
	}
	const folded = (k: string) => views.today.folded.includes(foldKey(k));
	// Stored keys are short and few; a long group name folds by its start.
	const foldKey = (k: string) => k.slice(0, 64);
	const fold = (k: string) => setToday({ folded: toggleIn(views.today.folded, foldKey(k)).slice(-100) });
	/** Every widget, the shown ones first in their order. */
	const allWidgets = $derived([...views.today.widgets, ...(Object.keys(WIDGETS) as WidgetKey[]).filter((w) => !views.today.widgets.includes(w))]);
	/** A move, said once it is saved. */
	const moved = (patch: Partial<typeof views.today>, said: string, undo: () => Promise<boolean>) => void setToday(patch).then((ok) => ok && showToast(said, undo));
	function reorderWidgets(order: string[], said: string) {
		const { widgets } = views.today;
		moved({ widgets: (order as WidgetKey[]).filter((w) => widgets.includes(w)) }, said, async () => !!(await setToday({ widgets })));
		return true;
	}
	function reorderSections(order: string[], said: string) {
		const was = sections;
		moved({ sections: order.map((k) => sections.find((s) => s.key === k)!) }, said, async () => !!(await setToday({ sections: was })));
		return true;
	}
	const toggleSection = (k: SectionKey) => setToday({ sections: sections.map((x) => (x.key === k ? { ...x, show: !x.show } : x)) });
	/** A list of habits was reordered: it goes into the one habit order (My order), shared with the Habits page. */
	function reorderHabits(part: string[], said: string) {
		const was = { order: views.today.order, sort: view.sort };
		const ids = [...data.build, ...data.resting].map((b) => b.habitId);
		const all = [...views.today.order, ...ids.filter((id) => !views.today.order.includes(id))];
		const order = reorderFrom(all, shownBuild.map((b) => b.habitId), part, view.sort === 'manual');
		if (view.sort !== 'manual') {
			view.sort = 'manual';
			said += ' Sorted by My order, shared with the Habits page.';
		}
		moved({ order }, said, async () => {
			view.sort = was.sort;
			return !!(await setToday({ order: was.order }));
		});
		return true;
	}
	function setHeadline(habitId: string, v: string) {
		const next = { ...views.today.headlineFor };
		if (v) next[habitId] = v as StatKey;
		else delete next[habitId];
		setToday({ headlineFor: next });
	}

	// The time of day, for the time-aware view. Ticks once a minute.
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
	/** The time-aware view keeps what fits now, what's still due from earlier, and anything without a time. */
	const timeHidden = $derived.by(() => {
		if (!views.today.timeAware || showAll || !currentPart) return new Set<string>();
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
	/** Finished, and past its moment in place. */
	const settled = (b: Item) => isDone(b) && !just.has(b.habitId);
	const shownBuild = $derived.by(() => {
		let list = sorted.filter((b) => !timeHidden.has(b.habitId));
		const at = layout === 'flat' ? 'bottom' : layout === 'focus' ? 'collapse' : views.today.done;
		if (at === 'bottom') list = [...list.filter((b) => !settled(b)), ...list.filter(settled)];
		if (at === 'collapse' || at === 'hide') list = list.filter((b) => !settled(b));
		return list;
	});
	const doneFolded = $derived(
		layout === 'focus' || views.today.done === 'collapse' || views.today.done === 'hide' ? sorted.filter((b) => !timeHidden.has(b.habitId) && settled(b)) : []
	);
	/** The one row whose Log stands out: what is stacked on something done, or else the first one due. */
	const upNext = $derived.by(() => {
		const due = shownBuild.flatMap((b) => [b, ...kidsOf(b.habitId)]).filter((b) => !isDone(b) && !(b.group && !b.group.routine && kidsOf(b.habitId).length));
		return (due.find((b) => b.upNext) ?? due[0])?.habitId;
	});
	const areaOf = (id: string | null) => data.areas.find((a) => a.id === id);
	const countOf = (items: Item[]) => {
		const all = items.flatMap((b) => (b.group ? kidsOf(b.habitId) : [b]));
		return all.length ? `${all.filter(isDone).length} of ${all.length} done` : '';
	};
	const groups = $derived(
		groupBy(
			shownBuild.map((b) => ({ ...b, part: partOf(b) })),
			layout === 'blocks' ? 'area' : view.group,
			{ areas: data.areas, parts: partNames }
		)
	);
	const breakingShown = $derived(data.breaking.filter((b) => passes(view, { ...b, direction: 'break' })));
	const sizeOf = (k: SectionKey) => ({ due: sorted.length, breaking: breakingShown.length, prep: hidden('prep') ? 0 : data.prep.length, paused: data.paused.length, resting: data.resting.length })[k];
	const emptySection = (k: SectionKey) => sizeOf(k) === 0;
	const showSection = (k: SectionKey) =>
		view.direction === 'build' ? k !== 'breaking' : view.direction === 'break' ? k === 'breaking' : true;
	const identityNames = $derived([...new Set([...data.build, ...data.breaking].flatMap((b) => b.identities))].sort());
	// A group is counted through the habits inside it.
	const doneCount = $derived(data.build.filter((b) => !b.group && isDone(b)).length);
	const atRiskItems = $derived(data.build.filter((b) => b.atRisk && !isDone(b)));
	const weekdayShort = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'narrow' });

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
		return [
			(layout === 'focus' || layout === 'flat') && view.group !== 'area' ? areaOf(item.areaId)?.name : null,
			st === 'due' ? (item.inProgress ? 'In progress' : 'Due') : null,
			item.multiVariant ? o.variantName : null,
			g?.total ? rollupText(g) : null,
			item.progress && st !== 'skipped' && (st === 'due' || isPartial(item.progress)) ? progressText(item.progress) : null,
			line('cue') ? cueLine(item.cue) : null,
			headlineOf(item)
		]
			.filter(Boolean)
			.join(' · ');
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
		if (item.group) return { act: { label: 'Start', href: `/routine/${o.id}` }, ways: [{ label: 'Mark all done', action: '?/done', fields, submit: log }, '-', skip] };
		const details: Way[] = o.slotCount ? [{ label: 'Log details…', href: `/log/${o.id}` }] : [];
		const post = o.slotCount ? '?/quick' : '?/done';
		const levels: Way[] =
			item.levels && line('levels') && !item.inProgress && (o.slotCount === 0 || item.quickDone || item.canRepeat)
				? (['minimum', 'target', 'stretch'] as const).map((l) => ({ label: levelName[l], value: item.levels![l], action: post, fields: { ...fields, level: l }, submit: log }))
				: [];
		const rest = [...levels, ...details, '-' as const, skip];
		if (item.progress?.kind === 'amount' && !pending[o.id])
			return { act: { label: stepLabel(item.progress), action: '?/plus', fields, submit: plus(o.id, item.name) }, ways: [...(details.length ? [] : [{ label: 'Log details…', href: `/log/${o.id}` }]), ...rest] };
		if (o.slotCount) {
			if (item.inProgress) return { act: { label: 'Resume', href: `/log/${o.id}` }, ways: [skip] };
			if (item.canRepeat) return { act: { label: 'Same as last', action: '?/same', fields, submit: log }, ways: rest };
			if (item.quickDone) return { act: { label: 'Done', action: '?/quick', fields, submit: log }, ways: rest };
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

<EditChrome
	title="Today"
	bind:mode
	modes={['use', 'edit']}
	hints={{ use: dateLabel, edit: 'Drag ⠿ to move. Order is shared with Habits.' }}
	onreset={resetLayout}
	{atDefault}
>
	{#snippet actions()}
		{#if data.canBackfill}<a class="button" href="/day">Log a past day</a>{/if}
		{#if !hidden('identities')}<a class="button" href="/identities">Identities</a>{/if}
	{/snippet}
	{#snippet tools()}
		<label class="layout-pick">Layout <select value={layout} onchange={(e) => setLayout(e.currentTarget.value as LayoutKey)}>{#each Object.entries(LAYOUTS) as [k, label] (k)}<option value={k}>{label}</option>{/each}</select></label>
	{/snippet}
</EditChrome>

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

{#if !data.build.length && !data.resting.length && !data.breaking.length && !data.paused.length}
	<Box hint="Write it as you would say it: what, how much, how often. Anything you can count or do." />
	<section class="ob-sec" aria-label="Or start from">
		<p class="meta muted">Or start from</p>
		<div class="chips">
			{#each PACKS.filter((p) => !data.packs.includes(p.id)) as p (p.id)}<button type="button" class="toggle" onclick={() => packIn(p.id, p.name)}>{p.name}</button>{/each}
		</div>
		<div class="l-cluster"><a class="button hit" href="/gallery">Gallery</a><a class="button hit" href="/habits/import">Add a file</a><a class="quiet hit" href="/habits/new">Step by step</a></div>
	</section>
{:else}
	<ViewBar
		page="today"
		bind:views
		bind:current={view}
		areas={data.areas}
		identities={hidden('identities') ? [] : identityNames}
		statuses={TODAY_STATUSES}
		direction={data.breaking.length > 0}
	>
		{@render layoutOptions()}
	</ViewBar>
	{#if hint && !retired.includes(hint) && mode === 'use'}
		<div class="ob-hint" role="note"><span class="meta">{HINTS[hint]}</span><button type="button" class="quiet hit" onclick={() => hint && retire(hint)}>Got it</button></div>
	{/if}

	{#if editing}
		<EditableList
			layout="block"
			items={allWidgets}
			key={(w) => w}
			label={(w) => WIDGETS[w]}
			mode="edit"
			ariaLabel="Widgets at the top"
			onmove={(_, order, text) => reorderWidgets(order, text)}
			onremove={(w) => setToday({ widgets: toggleIn(views.today.widgets, w) })}
			removeLabel={(w) => (views.today.widgets.includes(w) ? 'Hide' : 'Show')}
		>
			{#snippet title(w)}Widget: {WIDGETS[w]}{views.today.widgets.includes(w) ? '' : ' (hidden)'}{/snippet}
			{#snippet row(w)}
				{#if views.today.widgets.includes(w)}{@render widget(w)}{/if}
			{/snippet}
		</EditableList>
	{:else}
		{#each views.today.widgets as w (w)}
			{@render widget(w)}
		{/each}
	{/if}
{/if}

{#if layout === 'outline'}
	<EditableList
		class="sections"
		layout="bare"
		items={editing ? sections : sections.filter((x) => x.show && showSection(x.key) && !emptySection(x.key))}
		key={(s) => s.key}
		label={(s) => SECTIONS[s.key]}
		{mode}
		ariaLabel="Sections of Today"
		onmove={(_, order, text) => reorderSections(order, text)}
	>
		{#snippet row(sec, ctx)}
			{@const k = `section:${sec.key}`}
			<GroupHeading
				title={sec.key === 'breaking' && !limiting ? 'Breaking' : SECTIONS[sec.key]}
				{mode}
				count={sec.key === 'due' ? countOf(sorted) : String(sizeOf(sec.key))}
				grip={ctx.grip}
				hidden={!sec.show}
				folded={folded(k)}
				onfold={sec.show ? () => fold(k) : undefined}
				verb={editing ? verb : undefined}
			/>
			{#snippet verb()}<button type="button" class="quiet verb hit" aria-label="{sec.show ? 'Hide' : 'Show'} {SECTIONS[sec.key]}" onclick={() => toggleSection(sec.key)}>{sec.show ? 'Hide' : 'Show'}</button>{/snippet}
			{#if sec.show && showSection(sec.key) && !folded(k) && !ctx.dragging}{@render section(sec.key)}{/if}
		{/snippet}
	</EditableList>
{:else if layout === 'focus'}
	{@const first = shownBuild.filter((b) => b.habitId === upNext || kidsOf(b.habitId).some((k) => k.habitId === upNext))}
	{@const rest = shownBuild.filter((b) => !first.includes(b))}
	{#if first.length}
		<GroupHeading title="Up next" {mode} />
		{@render habitList(first, 'Up next')}
	{/if}
	{#if rest.length}
		<GroupHeading title="Still to do" {mode} count={String(rest.length)} />
		{@render habitList(rest, 'Still to do')}
	{/if}
	{@render timeLine()}
	{#if breakingShown.length}
		<GroupHeading title={limiting ? 'Limits' : 'Breaking'} {mode} count={String(breakingShown.length)} />
		{@render breakingSection()}
	{/if}
	{#if doneFolded.length}
		<GroupHeading title="Done today" {mode} count={String(doneFolded.length)} folded={folded('focus:done')} onfold={() => fold('focus:done')} />
		{#if !folded('focus:done')}{@render habitList(doneFolded, 'Done today')}{/if}
	{/if}
	{#if data.resting.length}
		<GroupHeading title="Not today" {mode} count={String(data.resting.length)} folded={folded('focus:later')} onfold={() => fold('focus:later')} />
		{#if !folded('focus:later')}{@render restingSection()}{/if}
	{/if}
	{@render laterLines(false)}
{:else if layout === 'blocks'}
	<ul class="elist blocks" data-mode="use">
		{#each groups as g (g.key)}
			<li class="holder area-block">
				<div class="card">
					<div class="content">
						<span class="name">{areaOf(g.key)?.icon ?? ''} {areaOf(g.key)?.name ?? 'No Area'}</span>{#if g.color}<span class="swatch" style:--c={g.color}></span>{/if}
						<span class="tags"><span class="tag count">{countOf(g.items)}</span></span>
					</div>
				</div>
				<div class="shelf">{@render habitList(g.items, g.label)}</div>
			</li>
		{/each}
		{#if breakingShown.length}
			<li class="holder area-block">
				<div class="card"><div class="content"><span class="name">{limiting ? 'Limits' : 'Breaking'}</span><span class="tags"><span class="tag count">{breakingShown.length}</span></span></div></div>
				<div class="shelf">{@render breakingSection()}</div>
			</li>
		{/if}
		{#if data.resting.length}
			<li class="holder area-block">
				<div class="card">
					<button type="button" class="fold" aria-expanded={!folded('blocks:later')} aria-label="Not today" onclick={() => fold('blocks:later')}><span class="chev" aria-hidden="true">›</span></button>
					<div class="content">
						<span class="name">Not today</span><span class="tags"><span class="tag count">{data.resting.length}</span></span>
						{#if folded('blocks:later')}<p class="meta-line">{data.resting.map((x) => x.name).join(', ')}</p>{/if}
					</div>
				</div>
				{#if !folded('blocks:later')}<div class="shelf">{@render restingSection()}</div>{/if}
			</li>
		{/if}
	</ul>
	{@render timeLine()}
	{@render laterLines(false)}
{:else}
	{@render habitList(shownBuild, 'Today')}
	{@render breakingSection()}
	{@render timeLine()}
	{@render laterLines(true)}
{/if}

{#if data.habitCount > 0 && data.habitCount < 3 && mode === 'use'}
	<section class="ob-sec" aria-label="Another habit"><Box question="What else do you want to track?" /></section>
{/if}

{#snippet laterLines(resting: boolean)}
	{#if data.prep.length && !hidden('prep')}
		<GroupHeading title="Prepare for tomorrow" {mode} depth={2} />
		{@render prepSection()}
	{/if}
	{#if data.paused.length}<p class="later-line">Paused: {data.paused.map((x) => `${x.name} until ${shortDate(x.pausedUntil!)}`).join(', ')}</p>{/if}
	{#if resting && data.resting.length}<p class="later-line">Not today: {data.resting.map((x) => x.name).join(', ')}</p>{/if}
{/snippet}

{#snippet section(key: SectionKey)}
	{#if key === 'due'}{@render dueSection()}
	{:else if key === 'breaking'}{@render breakingSection()}
	{:else if key === 'prep'}{@render prepSection()}
	{:else if key === 'paused'}{@render pausedSection()}
	{:else}{@render restingSection()}{/if}
{/snippet}

{#snippet widget(w: WidgetKey)}
	{#if w === 'progress' && data.build.length}
		<div class="card widget">
			<div class="row"><strong class="grow">{doneCount} of {data.build.length} done today</strong></div>
			<progress max={data.build.length} value={doneCount} aria-label="Done today"></progress>
		</div>
	{:else if w === 'week'}
		<div class="card widget week" role="group" aria-label="This week">
			{#each data.week as d (d.date)}
				{#if d.date < data.today && data.canBackfill}
					<a class="day" class:full={d.of > 0 && d.done === d.of} href="/day/{d.date}" aria-label="Log {shortDate(d.date)}">
						<span class="muted small-text">{weekdayShort(d.date)}</span>
						<span>{d.of ? `${d.done}/${d.of}` : '–'}</span>
					</a>
				{:else}
					<div class="day" class:today={d.date === data.today} class:full={d.of > 0 && d.done === d.of}>
						<span class="muted small-text">{weekdayShort(d.date)}</span>
						<span>{d.date > data.today ? '' : d.of ? `${d.done}/${d.of}` : '–'}</span>
					</div>
				{/if}
			{/each}
		</div>
	{:else if w === 'atRisk' && atRiskItems.length}
		<div class="card widget">
			<strong>Streaks at risk</strong>
			{#each atRiskItems as b (b.habitId)}
				<div class="small-text warn">{b.name}: missed last time, don't miss twice.</div>
			{/each}
		</div>
	{:else if w === 'quit' && data.breaking.length}
		<div class="card widget">
			{#each data.breaking as b (b.habitId)}
				<div class="row">
					<span class="grow">{b.name}</span>
					<strong>{plural(b.days, b.limit?.period === 'week' ? 'week' : 'day')}</strong>
					{#if b.cost?.saved && !hidden('cost')}<span class="muted small-text">saved {fmt(b.cost.saved)} {b.cost.unit}</span>{/if}
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet layoutOptions()}
	<div class="stack">
		<div class="row">
			<label class="grow"
				>Done items
				<select value={views.today.done} onchange={(e) => setToday({ done: e.currentTarget.value as keyof typeof DONE_MODES })}>
					{#each Object.entries(DONE_MODES) as [k, label] (k)}<option value={k}>{label}</option>{/each}
				</select>
			</label>
			<label class="grow"
				>Headline number
				<select value={views.today.headline} onchange={(e) => setToday({ headline: e.currentTarget.value as StatKey })}>
					{#each Object.entries(STATS) as [k, label] (k)}<option value={k}>{label}</option>{/each}
				</select>
			</label>
		</div>
		<label style="color: var(--ink)"
			><input
				type="checkbox"
				checked={views.today.timeAware}
				disabled={!data.ranges.length}
				onchange={() => setToday({ timeAware: !views.today.timeAware })}
			/>
			Only show what fits the current part of the day{data.ranges.length ? '' : ' (add parts of your day in Settings first)'}</label
		>
		<div>
			<span class="muted small-text">Lines on each habit</span>
			<div class="chips" role="group" aria-label="Lines on each habit">
				{#each Object.entries(LINES) as [k, label] (k)}
					{@const f = featureOf[k as LineKey]}
					{#if !f || !hidden(f)}
						<button
							type="button"
							class="toggle"
							aria-pressed={views.today.lines.includes(k as LineKey)}
							onclick={() => setToday({ lines: toggleIn(views.today.lines, k as LineKey) })}>{label}</button
						>
					{/if}
				{/each}
			</div>
		</div>
	</div>
{/snippet}

{#snippet habitList(items: Item[], name: string)}
	<EditableList
		{items}
		key={(b) => b.habitId}
		label={(b) => b.name}
		{mode}
		rowCard
		holder={(b) => !!b.group && kidsOf(b.habitId).length > 0}
		itemClass={(b) => [isDone(b) && statusOf(b.occurrence!) === 'skipped' ? 'skipped' : isDone(b) ? 'done' : '', just.has(b.habitId) ? 'just-done' : '', b.afterHabitId ? 'stacked' : ''].join(' ')}
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
	<a class="name" href="/habits/{item.habitId}/chain">{item.name}</a>
	{#if item.habitId === upNext && layout !== 'focus'}<span class="tags"><StatusTag status="upNext" /></span>{/if}
	<p class="meta-line">
		{#if done}<span class="mark" aria-hidden="true">{st === 'skipped' ? '↷' : '✓'}</span> {done}{#if just.get(item.habitId)?.words}{' · '}{just.get(item.habitId)?.words}{/if}{meta(item) ? ' · ' : ''}{/if}{meta(item)}
	</p>
	{#if item.atRisk && st === 'due'}<p class="row-line warn meta">You missed last time. Don't miss twice{item.levels ? ': even the Minimum counts' : ''}.</p>{/if}
	{#if item.levels?.minimum && line('levels') && st === 'due'}<p class="row-line meta">Minimum: {item.levels.minimum}</p>{/if}
	{#if item.reframe && line('reframe')}<p class="row-line meta">{item.reframe}</p>{/if}
	{#if item.bundle && line('bundle')}
		<p class="row-line meta">{item.bundle.strict ? (o.status === 'done' ? 'Earned' : 'After this') : 'Pair with'}: {item.bundle.reward}</p>
	{/if}
	{#if item.reward?.jar && line('reward')}
		<p class="row-line meta">Jar: {fmt(item.reward.jar.total)} {item.reward.jar.unit}{item.reward.jar.goal ? ` toward ${item.reward.jar.goal}` : ''}</p>
	{/if}
	{#if item.identities.length && line('identities')}<p class="row-line meta">{item.identities.join(' · ')}</p>{/if}
	{#if item.progression && line('progression')}
		{@const p = item.progression}
		<div class="notice" data-mode={mode}>
			<span class="notice-text meta"
				>You've hit your targets {p.hits} times in a row. Raise them by {p.by}{p.unit === 'percent' ? '%' : p.by === 1 ? ' step' : ' steps'}? {p.changes.join(' · ')}</span
			>
			<span class="notice-acts">
				<form method="POST" action="?/raise" use:enhance><input type="hidden" name="habit" value={item.habitId} /><button class="quiet hit" aria-label="Raise the targets of {item.name}">Raise</button></form>
				<form method="POST" action="?/notYet" use:enhance><input type="hidden" name="habit" value={item.habitId} /><button class="quiet hit" aria-label="Not yet for {item.name}">Not yet</button></form>
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
		{#if item.group || o.slotCount > 0}<a class="quiet hit" href={item.group ? `/routine/${o.id}` : `/log/${o.id}`} aria-label="View {item.name}">View</a>{/if}
		{@const undo = just.get(item.habitId)?.undo}
		{#if undo}
			<button type="button" class="quiet hit" aria-label="Undo {item.name}" onclick={undo}>Undo</button>
		{:else}
			<form method="POST" action="?/undo" use:enhance>
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
			<option value="">Default ({STATS[views.today.headline]})</option>
			{#each Object.entries(STATS) as [k, label] (k)}<option value={k}>{label}</option>{/each}
		</select>
	</label>
{/snippet}

{#snippet timeLine()}
	{#if timeHidden.size}
		<p class="muted small-text">
			Showing what fits {currentPart}. <button class="link" onclick={() => (showAll = true)}>Show all ({timeHidden.size} more)</button>
		</p>
	{:else if showAll && views.today.timeAware}
		<p class="muted small-text"><button class="link" onclick={() => (showAll = false)}>Only show what fits now</button></p>
	{/if}
{/snippet}

{#snippet dueSection()}
	{#each groups as g (g.key)}
		{@const a = view.group === 'area' ? areaOf(g.key) : undefined}
		{#if g.label}
			<GroupHeading depth={2} title={a?.name ?? g.label} icon={a?.icon} color={g.color} {mode} count={countOf(g.items)} folded={folded(`group:${g.key}`)} onfold={() => fold(`group:${g.key}`)} />
		{/if}
		{#if !g.label || !folded(`group:${g.key}`)}{@render habitList(g.items, g.label || 'Due today')}{/if}
	{/each}
	{@render timeLine()}
	{#if doneFolded.length}
		<GroupHeading
			depth={2}
			title="Done"
			{mode}
			count={String(doneFolded.length)}
			folded={views.today.done === 'hide' || folded('done')}
			onfold={views.today.done === 'hide' ? undefined : () => fold('done')}
		/>
		{#if views.today.done !== 'hide' && !folded('done')}{@render habitList(doneFolded, 'Done today')}{/if}
	{/if}
{/snippet}

{#snippet breakingSection()}
	<EditableList items={breakingShown} key={(b) => b.habitId} label={(b) => b.name} mode="use" rowCard ariaLabel={limiting ? 'Limits' : 'Breaking'}>
		{#snippet row(b)}
			{@const plan = b.ifThen}
			<a class="name" href="/habits/{b.habitId}/chain">{b.name}</a>
			<p class="meta-line">
				{[
					b.limit ? `${b.limit.used} of ${b.limit.max} ${b.limit.period === 'week' ? 'this week' : 'today'}` : null,
					`${plural(b.days, b.limit?.period === 'week' ? 'week' : 'day')}${b.limit ? ' within limit' : ''}`,
					b.limit ? null : `longest ${plural(b.longest, 'day')}`,
					b.slippedToday && !b.limit ? `${b.slippedToday} today` : null,
					b.resistedThisWeek ? `resisted ${b.resistedThisWeek}× this week` : null
				]
					.filter(Boolean)
					.join(' · ')}
			</p>
			{#if b.limit && b.limit.used > b.limit.max}<p class="row-line warn meta">Over the limit.</p>{/if}
			{#if b.limit?.next}<p class="row-line meta">{b.limit.next.max} from {shortDate(b.limit.next.date)}</p>{/if}
			{#if plan && (plan.then || plan.habit) && !hidden('ifThen')}
				<p class="row-line meta">If I {plan.when || 'feel the urge'}, I will {[plan.then, plan.habit].filter(Boolean).join(' or ')}.</p>
			{/if}
			{#if b.reframe && !hidden('reframe')}<p class="row-line meta">{b.reframe}</p>{/if}
			{#if b.cost && !hidden('cost')}
				<p class="row-line meta">Slips this month cost {fmt(b.cost.month)} {b.cost.unit}{b.cost.saved !== null ? ` · saved ${fmt(b.cost.saved)} ${b.cost.unit} so far` : ''}</p>
			{/if}
			{#if form?.habit === b.habitId && form?.error}<p class="row-line error meta">{form.error}</p>{/if}
			{#if b.top.length}<p class="row-line meta">Most slips: {b.top.slice(0, 2).map(triggerLine).join(' · ')}</p>{/if}
			{#if b.identities.length && line('identities')}<p class="row-line meta">{b.identities.join(' · ')}</p>{/if}
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
	.widget {
		margin-bottom: 0.75rem;
	}
	:global(.elist.block .widget) {
		margin-bottom: 0;
	}
	:global(.elist.sections) {
		margin-top: 0.75rem;
	}
	.headline-pick {
		margin-top: 0.5rem;
	}
	.widget progress {
		width: 100%;
	}
	.week {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		text-align: center;
	}
	.week .day {
		display: flex;
		flex-direction: column;
	}
	.week .today {
		font-weight: 600;
	}
	.week a.day {
		color: inherit;
		text-decoration: none;
		border-radius: 6px;
	}
	.week a.day:hover {
		background: var(--line);
	}
	.nudge {
		align-items: center;
		margin-bottom: 0.75rem;
		border-color: var(--accent);
	}
	.week .full span:last-child {
		color: var(--accent);
	}
	:global(.elist > li.stacked) {
		margin-inline-start: var(--space-indent);
	}
	.blocks {
		--gap: var(--space-group);
	}
	.layout-pick {
		display: inline-flex;
		align-items: center;
		gap: var(--space-tight);
	}
	.layout-pick select {
		width: auto;
		padding-block: 0;
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
		text-align: left;
	}
	.check .box {
		width: 1.2rem;
		height: 1.2rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		display: inline-grid;
		place-items: center;
		font-size: 0.8rem;
		color: var(--accent);
	}
	.check.done {
		color: var(--ink-muted);
		text-decoration: line-through;
	}
</style>
