<script lang="ts">
	import { enhance } from '$app/forms';
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, tick, untrack } from 'svelte';
	import Timer from './Timer.svelte';
	import Place from '$lib/log/Place.svelte';
	import EditPlaces, { type EditPlace } from '$lib/log/EditPlaces.svelte';
	import { inOrder, slotIn, toCount, withoutSlot, withSlot, withTask, type Plan } from '$lib/log/plan';
	import { circuitsOf, roundWords, type Circuit } from '$lib/log/circuit';
	import { cap, cursor, follow, rowsText, rowText, valueText, type Cursor, type Field, type RowState } from '$lib/log/run';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import type { Mode } from '$lib/ui/list';
	import MenuButton, { type Way } from '$lib/ui/MenuButton.svelte';
	import NumberField from '$lib/ui/NumberField.svelte';
	import { endRest, startRest } from '$lib/rest.svelte';
	import { defaultStep } from '$lib/task-types';
	import { units } from '$lib/units-here';
	import { enqueue, isOffline, outbox, save, sendAhead } from '$lib/outbox.svelte';
	import { waitingSwaps } from '$lib/queue';
	import { postAction, runAction, showError, showToast, undoWith } from '$lib/toast.svelte';
	import { differs, revOf, type LogContent } from '$lib/logrev';
	import { besides, carryOver, doneBefore, doneLine, fromDraft, keptText, loggedAt, placeKey, setsToDo, swapGroups, swapText, usedText, withWaiting, type Logged } from '$lib/log/places';
	import SwapSheet from '$lib/log/SwapSheet.svelte';
	import NoteBox from '$lib/NoteBox.svelte';
	import Markdown from '$lib/Markdown.svelte';
	import { starterFor, untouched } from '$lib/journal';
	import { saveSetting } from '$lib/settings/save';
	import { hasLog, isSuggestion, keepsSuggestions, onlySuggested, setByHand, type PlaceStart } from '$lib/prefill';

	import type { ActionData, PageData } from './$types';
	import { backLabel } from '$lib/back';

	let { data, form }: { data: Extract<PageData, { routine: null }>; form: ActionData } = $props();

	type Values = Record<string, unknown>;
	/** One place in the log: a Slot's Task, or a Task inside it (see engine/parts.ts). */
	interface ItemState {
		sets: RowState[];
		summary: Values;
		/** The tick of a Yes or no Task, or of a step (no fields and nothing inside). */
		tick?: boolean;
		/** A station of a round, answered by its tick: its values count, also those only suggested (or, false, none do). */
		kept?: boolean;
		/** Once-per-log fields set by hand: logged, even when the value is the suggested one (see src/lib/prefill.ts). */
		own?: string[];
	}
	type Item = (typeof data.items)[number];
	type Metric = NonNullable<Item['task']>['metrics'][number];

	/** A Task whose fields and last time this page holds, so a swap to it can show at once, also offline. */
	const onDevice = (id: string) => data.alts[id] ?? data.items.find((x) => x.depth === 0 && x.kids === 0 && x.task?.id === id);
	/** Swaps that wait to be sent (made offline), by Slot: shown at once, until they sync. */
	const offlinePicks = $derived(waitingSwaps(outbox.items, `/log/${data.occurrence.id}?/swap`));
	/** The places in the log: the server's, with a swap made offline in place of its Slot's Task (and its parts). */
	const items = $derived(withWaiting(data.items, offlinePicks, onDevice, data.orphans.map((e) => ({ taskId: e.taskId, path: e.path ?? null, values: e.values }))));
	// A swap that leaves the outbox reached the server (or was refused there): the Slot shows what the server holds
	// now, which this page loads again, as a page save that sends it first doesn't.
	let waited: Record<string, string> = {};
	$effect(() => {
		const now = offlinePicks;
		if (Object.keys(waited).some((s) => !(s in now))) void invalidateAll();
		waited = now;
	});
	/**
	 * What a Task swapped in starts from when it has no last time of its own: the values the Task it replaced still
	 * had to do, where name and unit match. By Slot; read when its place starts.
	 */
	let carried = $state.raw<Record<string, { id: string; from: string; fields: Metric[]; rows: Values[] }>>({});

	const isSummary = (v: Values) => v._summary === true;
	/** A Yes or no tick: an Entry that only says it was done. */
	const isTick = (v: Values) => v.done === true && Object.keys(v).length === 1;
	/** A Yes or no Task or a step: nothing to fill in and nothing inside, so it gets one tick box. */
	const isYesNo = (it: Item) => !!it.task && !it.task.metrics.length && it.kids === 0;
	/** Quick log (from a shortcut or link): only the fields marked for quick logs. */
	const quickMode = $derived(page.url.searchParams.has('quick'));
	/** Not finished yet: due today, or a past day that was missed, skipped or never logged. */
	const isOpen = $derived(data.occurrence.status !== 'done' && data.canLog);
	/** A finished log: it can always be corrected, and saves as you do. */
	const correcting = $derived(data.occurrence.status === 'done');
	const stage = $derived<'run' | 'correct' | 'read'>(isOpen ? 'run' : correcting ? 'correct' : 'read');

	/**
	 * Where a field's starting value comes from, per its log setting. A tick box always
	 * starts unticked: a tick says you did it this time, so it is never copied.
	 */
	function prefillValue(m: Metric, it: Item, last: unknown): unknown {
		const target = it.targets[m.id];
		if (m.prefill === 'blank' || m.type === 'checkbox') return undefined;
		if (m.prefill === 'target') return target ?? last;
		return last ?? target;
	}

	const isLong = (m: Metric) => m.type === 'text' && m.long;
	/** Long text fields that are still empty start with their prompt and starter text (never last time's text). */
	function withStarters(summary: Values, t: NonNullable<Item['task']>): Values {
		for (const m of t.metrics) {
			if (!isLong(m) || m.repeats) continue;
			const v = summary[m.id];
			if (typeof v === 'string' && v.trim()) continue;
			const start = starterFor(m, data.occurrence.date);
			if (start) summary[m.id] = start;
		}
		return summary;
	}

	/** The planned sets and values for a Slot, before anything is logged: a prefill from last time. */
	function planned(it: Item): ItemState {
		const t = it.task;
		if (!t) return { sets: [], summary: {} };
		const repeating = t.metrics.filter((m) => m.repeats);
		const single = t.metrics.filter((m) => !m.repeats);
		const prev = it.previous.filter((v) => !isSummary(v));
		const prevSummary = it.previous.find(isSummary) ?? {};
		// Swapped in after sets were done with another Task: only the sets still to do. Read when the place starts.
		const before = untrack(() => setsBefore(it));
		const count = repeating.length ? setsToDo(it.sets ?? (prev.length || 1), before) : 0;
		// Never done: from the values the Task it replaced still had to do.
		const from = prev.length ? prev : carriedTo(it).rows;
		const sets = Array.from({ length: count }, (_, i) => ({
			done: false,
			values: Object.fromEntries(
				repeating
					.map((m) => [m.id, prefillValue(m, it, (from[i] ?? from.at(-1))?.[m.id])] as const)
					.filter(([, v]) => v !== undefined)
			) as Values
		}));
		const summary = Object.fromEntries(
			single.map((m) => [m.id, prefillValue(m, it, prevSummary[m.id])] as const).filter(([, v]) => v !== undefined)
		) as Values;
		// A Yes or no Task or a step starts unticked like any tick box: you tick the ones you did.
		return { sets, summary: withStarters(summary, t), tick: false };
	}

	/** What carries over to a place from the Task its Slot had before a swap (see `carried`), and from which Task. */
	function carriedTo(it: Item): { from: string; rows: Values[]; ids: string[] } {
		const c = untrack(() => carried[it.slotId]);
		const t = it.task;
		if (!c || !t || it.depth || c.id === t.id || it.previous.some((v) => !isSummary(v))) return { from: '', rows: [], ids: [] };
		return { from: c.from, ...carryOver(c.fields, c.rows, t.metrics.filter((m) => m.repeats)) };
	}

	/**
	 * Build the editable state for a place. A finished log shows what was saved. A log
	 * that is still due shows the saved (ticked) sets first, then the planned sets not
	 * logged yet, so leaving half way through a workout loses nothing.
	 */
	function initial(it: Item): ItemState {
		const t = it.task;
		if (!t) return { sets: [], summary: {} };
		// Sets are Entries with per-set fields; a Yes or no tick is not a set.
		const perSet = t.metrics.some((m) => m.repeats);
		const savedSets = perSet ? it.saved.filter((v) => !isSummary(v) && !isTick(v)) : [];
		const savedSummary = it.saved.find(isSummary) ?? {};
		// Not finished: due today, or a past day that was missed, skipped or never logged.
		const due = data.occurrence.status !== 'done';
		if (due && !it.saved.length) return planned(it);
		const sets = savedSets.map((values) => ({ done: true, values: { ...values } }));
		if (due) sets.push(...planned(it).sets.slice(sets.length));
		return {
			sets,
			// Still open: fields not saved yet show their suggestion again (it is saved only once touched or confirmed).
			summary: due ? { ...planned(it).summary, ...savedSummary } : { ...savedSummary },
			tick: isYesNo(it) && it.saved.some((v) => v.done === true)
		};
	}

	const DRAFT = untrack(() => `log-draft:${data.occurrence.id}`);
	interface Draft {
		/** By place; drafts from before this are a list. */
		log: Record<string, ItemState> | ItemState[];
		notes: string;
		level: 'minimum' | 'target' | 'stretch';
		synced: boolean;
		/** The versions it grew from (see `bases`); drafts from before this have none. */
		bases?: string[];
		/** See `held`; drafts from before this have none. */
		held?: Record<string, Logged[]>;
	}
	const readDraft = (): Draft | null => {
		try {
			return JSON.parse(localStorage.getItem(DRAFT) ?? 'null');
		} catch {
			return null;
		}
	};

	/**
	 * What each place had logged when it was last shown, by place, so it is saved with the log when a
	 * swap, Pick another or a reload takes the place away before that reached the server: a past day
	 * reaches it only on Finish. Kept with the draft.
	 */
	let held = $state.raw<Record<string, Logged[]>>({});
	/** What is being logged, by place. A place that goes keeps its values here, in case it comes back. */
	const places = $state<Record<string, ItemState>>(untrack(() => Object.fromEntries(items.map((it) => [placeKey(it), initial(it)]))));
	/** The prefill, to show which values differ from it. */
	const startOf = (it: Item): ItemState => (data.occurrence.status === 'done' ? initial(it) : { ...initial(it), sets: planned(it).sets });
	let base = $state.raw<Record<string, ItemState>>(untrack(() => Object.fromEntries(items.map((it) => [placeKey(it), startOf(it)]))));
	// A place that comes into the log (a swap, a reroll, a part added) starts as the log does.
	$effect.pre(() => {
		const fresh = items.filter((it) => untrack(() => !places[placeKey(it)]));
		untrack(() => {
			for (const it of fresh) {
				const s = initial(it);
				base = { ...base, [placeKey(it)]: startOf(it) };
				places[placeKey(it)] = s;
			}
		});
	});
	/** The same, in the order the log shows them. */
	const log = $derived(items.map((it) => places[placeKey(it)] ?? initial(it)));
	const baseOf = (i: number): ItemState | undefined => base[placeKey(items[i])];
	let notes = $state(untrack(() => data.occurrence.notes));
	let level = $state<'minimum' | 'target' | 'stretch'>(untrack(() => data.occurrence.level));
	let problem = $state('');
	const levelNames = { minimum: 'Minimum', target: 'Target', stretch: 'Stretch' } as const;
	/** The target for a Metric at the chosen level, falling back to Target. */
	const targetAt = (it: Item, id: string) =>
		(level === 'minimum' ? it.minTargets[id] : level === 'stretch' ? it.stretchTargets[id] : undefined) ??
		it.targets[id];
	// ----- Autosave: every change is kept on this device at once, and on the server shortly after -----
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	/** The autosave sent and not answered yet. */
	let onTheWay: ReturnType<typeof save> | undefined;
	let saveState = $state<'idle' | 'saving' | 'saved' | 'local' | 'refused'>('idle');
	let refusedWhy = $state('');
	/**
	 * The versions of this log that this one grew from: what the server had when it was loaded, and
	 * what was sent since and not answered yet. The server refuses a save made from any other.
	 */
	let bases = $state.raw<string[]>(untrack(() => [data.rev]));
	/** The log as another device left it, and what was being saved when that came out. */
	let theirs = $state.raw<(LogContent & { rev: string; from: 'autosave' | 'finish' }) | null>(null);
	const snapshot = $derived(JSON.stringify({ log, notes, level }));
	let primed = false;

	onMount(() => {
		// Restore work that never reached the server (a reload while offline, a crash).
		const d = readDraft();
		// Also what is planned and not logged yet, such as a weight carried to the sets still to do,
		// as long as the server's log is still the one this draft grew from.
		if (d && data.occurrence.status !== 'done' && (!d.synced || d.bases?.includes(data.rev))) {
			Object.assign(places, fromDraft(d.log, items));
			notes = d.notes;
			level = d.level;
			held = d.held ?? {};
			// Not what is on the server now: if that changed since, the save says so.
			if (d.bases?.length) bases = d.bases;
		}
		restoreOffer();
		return () => clearTimeout(saveTimer);
	});

	$effect(() => {
		void snapshot;
		if (!primed) {
			primed = true;
			return;
		}
		untrack(() => {
			if (!isOpen && !correcting) return;
			// A finished log saves as it is corrected; there is nothing to finish, so no draft of it.
			if (isOpen) writeDraft(false);
			// A past day is saved on Finish only, so leaving it half done doesn't leave a partial log.
			if (data.past && isOpen) return;
			clearTimeout(saveTimer);
			saveTimer = setTimeout(autosave, 1500);
		});
	});

	function writeDraft(synced: boolean) {
		held = { ...held, ...Object.fromEntries(items.map((it, i) => [placeKey(it), entriesAt(it, i, false)])) };
		try {
			localStorage.setItem(DRAFT, JSON.stringify({ log: $state.snapshot(places), notes, level, synced, bases, held }));
		} catch {
			/* storage blocked */
		}
	}
	const clearDraft = () => {
		try {
			localStorage.removeItem(DRAFT);
		} catch {
			/* storage blocked */
		}
	};
	const saveUrl = () => `/log/${data.occurrence.id}?/save`;

	async function autosave() {
		saveTimer = undefined;
		const sent = snapshot;
		saveState = 'saving';
		// Correcting: what counts is worked out again, so it is finished again with what it holds now.
		const gaps = correcting ? missing() : [];
		if (gaps.length) {
			saveState = 'refused';
			refusedWhy = `Fill in ${gaps.join(', ')}.`;
			return { kind: 'refused' as const, why: refusedWhy };
		}
		const body = payload(correcting, true);
		const mine = sending(body);
		const going = save(saveUrl(), [['payload', body]], data.habitName);
		onTheWay = going;
		const a = await going;
		if (onTheWay === going) onTheWay = undefined;
		// The server holds exactly this now; what was sent after it may be there next.
		if (a.kind === 'saved') {
			bases = bases.slice(bases.indexOf(mine));
			theirs = null;
		}
		if (a.kind === 'refused' && a.stale) changedElsewhere(a.stale, 'autosave');
		// Changed while it was being sent: the next save, already on its way, says how that went.
		if (snapshot !== sent) return a;
		if (a.kind === 'saved' && isOpen) writeDraft(true);
		if (a.kind === 'saved' && correcting) offerUndo();
		refusedWhy = a.kind === 'refused' ? a.why : '';
		saveState = a.kind === 'later' ? 'local' : a.kind;
		return a;
	}

	/** What is being sent may be on the server before its answer is here: later saves may grow from it. */
	function sending(body: string): string {
		const rev = revOf(JSON.parse(body) as LogContent);
		bases = [...bases.filter((b) => b !== rev), rev].slice(-20);
		if (isOpen) writeDraft(false);
		return rev;
	}

	function changedElsewhere(now: unknown, from: 'autosave' | 'finish') {
		clearTimeout(saveTimer);
		saveTimer = undefined;
		theirs = { ...(now as LogContent & { rev: string }), from };
	}
	const taskName = (id: string) => items.find((it) => it.task?.id === id)?.task?.name ?? 'another Task';
	const changed = $derived(theirs ? differs(JSON.parse(payload(false, true)) as LogContent, theirs, taskName) : []);

	/** Save this one over what the other device left. */
	async function keepMine() {
		if (!theirs) return;
		const { rev, from } = theirs;
		bases = [rev];
		theirs = null;
		if (from === 'finish') {
			await tick(); // the form holds the payload
			finishForm?.requestSubmit();
		} else await autosave();
	}
	/** Show what the other device left. This one is kept aside, so it can be had back. */
	const ASIDE = untrack(() => `log-aside:${data.occurrence.id}`);
	function useTheirs() {
		try {
			localStorage.setItem(ASIDE, JSON.stringify({ log: $state.snapshot(places), notes, level }));
		} catch {
			/* storage blocked: there is nothing to have back */
		}
		clearDraft();
		theirs = null;
		location.reload();
	}
	function restoreOffer() {
		let d: Pick<Draft, 'log' | 'notes' | 'level'> | null = null;
		try {
			d = JSON.parse(localStorage.getItem(ASIDE) ?? 'null');
			localStorage.removeItem(ASIDE);
		} catch {
			/* storage blocked */
		}
		if (!d) return;
		const mine = d;
		showToast('Showing what the other device saved.', () => {
			if (!mounted) {
				// Kept for the next time it is opened, which offers it again.
				localStorage.setItem(ASIDE, JSON.stringify(mine));
				return 'Open the log to bring yours back.';
			}
			Object.assign(places, fromDraft(mine.log, items));
			notes = mine.notes;
			level = mine.level;
		});
	}

	// Leaving before the autosave ran (Back right after a tick): save first, then go, so the
	// page you land on already shows it.
	beforeNavigate((nav) => {
		if (saveTimer === undefined) return;
		clearTimeout(saveTimer);
		// Leaving the app (or Back to a page loaded on its own): the page goes away, so send
		// the save in a request that outlives it.
		if (nav.willUnload || !nav.to) {
			saveTimer = undefined;
			const body = new FormData();
			const sent = payload(false, true);
			sending(sent);
			body.set('payload', sent);
			void fetch(saveUrl(), { method: 'POST', body, keepalive: true, headers: { 'x-sveltekit-action': 'true' } }).catch(() => {});
			return;
		}
		// The browser's own Back can't wait; the save still goes out.
		if (nav.type === 'popstate') return void autosave();
		nav.cancel();
		const to = nav.to.url;
		autosave().finally(() => goto(to));
	});
	/** Stop a pending autosave, for actions that save the log another way. */
	const dropAutosave = () => {
		clearTimeout(saveTimer);
		saveTimer = undefined;
	};
	/**
	 * Save the log as it is here, after a save on its way, before an action that takes a place out of
	 * it (a swap, Pick another, out of the plan), so the server holds what was logged there. Always,
	 * not only with a save pending: one may have waited, been refused, or a draft come back unsaved.
	 * A past day is saved on Finish only: it is kept on this device, with what each place holds.
	 */
	async function saveFirst() {
		if (data.past) {
			writeDraft(false);
			return { kind: 'saved' as const };
		}
		await onTheWay;
		dropAutosave();
		return autosave();
	}

	/**
	 * What each place started with: its suggested values (last time's, or targets) and what was saved.
	 * A finished log suggests nothing: it shows only what was saved, so whatever is typed into it is a log.
	 */
	const starts = $derived<PlaceStart[]>(
		items.map((it) => ({ prefill: correcting ? {} : planned(it).summary, saved: it.saved.find(isSummary) ?? {}, savedAny: it.saved.length > 0 }))
	);
	/** A once-per-log field set by hand. */
	const setOnce = (i: number, id: string, v: unknown) => void setByHand(log[i], id, v);
	/** A chip that only shows a suggestion is picked by a tap; one picked by hand is unpicked. */
	const pickChip = (i: number, id: string, choice: string) =>
		setOnce(i, id, log[i].summary[id] === choice && !isSuggestion(log[i], starts[i], id) ? null : choice);
	/** Finish was answered "Yes" for places that still show only suggested values: they are kept. */
	let suggestionsConfirmed = $state(false);

	/**
	 * What gets saved. Only ticked sets: a planned set nobody ticked was not done (Finish asks
	 * first, see untickedSets). Every set counts as done on a quick log, since only some
	 * fields are shown there. A suggested value (last time's, or the target) nobody touched is
	 * not saved as you go, and on Finish only as src/lib/prefill.ts says.
	 */
	function payload(finish: boolean, stay = false) {
		const entries = items.flatMap((it, i) => entriesAt(it, i, finish));
		// Values for places this log no longer shows go back as they were.
		entries.push(...elsewhere());
		return JSON.stringify({ finish, stay, notes, entries, level, back: data.back, bases });
	}
	/** What the log holds besides the places it shows: a Slot's Task before a swap, a part removed. */
	function elsewhere() {
		return besides(held, items, data.orphans.map((e) => ({ taskId: e.taskId, path: e.path ?? null, values: e.values })));
	}
	/** Sets done here with another Task before its Slot was swapped. Hoisted: the places start with it. */
	function setsBefore(it: Item) {
		return doneBefore(elsewhere(), it).reduce((n, d) => n + d.sets, 0);
	}
	/** Done here with another Task before its Slot was swapped, a line each: "Bench press · 2 sets done". */
	const doneLines = (it: Item) =>
		doneBefore(elsewhere(), it).map(({ taskId, sets }) => {
			const t = data.library.find((l) => l.id === taskId);
			return doneLine(t?.name ?? 'Another Task', sets, t?.rowOne ?? 'set', t?.rowMany ?? 'sets');
		});
	/** What gets saved at a place. Each value says where it sits, so the same Task in two places keeps its own. */
	function entriesAt(it: Item, i: number, finish: boolean): Logged[] {
		const path = it.path;
		const t = it.task;
		if (!t) return [];
		const entries: Logged[] = [];
		const s = log[i];
		const repeatingIds = t.metrics.filter((m) => m.repeats).map((m) => m.id);
		const counts = (set: { done: boolean; values: Values }) => set.done || (quickMode && finish);
		const sets = repeatingIds.length ? s.sets.filter(counts) : [];
		for (const set of sets) {
			entries.push({
				taskId: t.id,
				path,
				values: Object.fromEntries(repeatingIds.map((id) => [id, set.values[id] ?? null]))
			});
		}
		// A long text field that still holds only its starter text counts as not written.
		const longs = new Map(t.metrics.filter(isLong).map((m) => [m.id, m]));
		const keep = stationIn.has(i) ? !!s.kept : (quickMode && finish) || keepsSuggestions(log, starts, i, { finish, confirmed: suggestionsConfirmed });
		const filled = Object.entries(s.kept === false ? {} : s.summary).filter(
			([k, v]) =>
				v !== '' &&
				v !== null &&
				v !== undefined &&
				!(longs.has(k) && untouched(longs.get(k)!, v, data.occurrence.date)) &&
				(keep || !isSuggestion(s, starts[i], k))
		);
		if (filled.length) entries.push({ taskId: t.id, path, values: { ...Object.fromEntries(filled), _summary: true } });
		if (s.tick && isYesNo(it)) entries.push({ taskId: t.id, path, values: { done: true } });
		return entries;
	}

	const empty = (v: unknown) => v === undefined || v === null || v === '' || v === false;

	/** Planned sets with values in them that nobody ticked, which Finish would leave out. */
	function untickedSets(): number {
		if (quickMode || !isOpen) return 0;
		let n = 0;
		items.forEach((it, i) => {
			if (stationIn.has(i)) return;
			if (circuits.has(i)) n += rowsAt(i).filter((x) => !x.done).length;
			const ids = it.task?.metrics.filter((m) => m.repeats).map((m) => m.id) ?? [];
			n += log[i]?.sets.filter((set) => !set.done && ids.some((id) => !empty(set.values[id]))).length ?? 0;
		});
		return n;
	}
	/** Places that still show only suggested values while others have a log (a session left half way), by name. */
	function suggestedPlaces(): string[] {
		if (quickMode || !isOpen) return [];
		return onlySuggested(log, starts).filter((i) => !stationIn.has(i)).map((i) => {
			const it = items[i];
			const round = [...it.path.matchAll(/#(\d+)/g)].at(-1)?.[1];
			return `${it.task?.name ?? 'Task'}${round ? ` (round ${round})` : ''}`;
		});
	}
	let finishForm = $state<HTMLFormElement>();
	const unticked = $derived(untickedSets());
	const suggested = $derived(suggestionsConfirmed ? [] : suggestedPlaces());
	/** Required fields that are still empty, by name. */
	function missing(): string[] {
		const out: string[] = [];
		items.forEach((it, i) => {
			const t = it.task;
			if (!t || (stationIn.has(i) && !answered(i))) return;
			for (const m of t.metrics.filter((x) => x.required)) {
				const bad = m.repeats
					? log[i].sets.some((s) => (s.done || quickMode) && empty(s.values[m.id])) || !log[i].sets.length
					: isLong(m)
						? untouched(m, log[i].summary[m.id], data.occurrence.date)
						: empty(log[i].summary[m.id]);
				if (bad) out.push(`${t.name}: ${m.name}`);
			}
		});
		return out;
	}

	// ----- Running the log: one open row; Done is the only thing that logs a set -----

	let at = $state<Cursor | null>(null);
	/** The place you are in. */
	let here = $state<string | null>(null);
	/** The row that was just logged, for a moment: one press logs one set. */
	let logged = $state<Cursor | null>(null);
	let said = $state('');
	const LOGGED_MS = 1000;

	const repeatingOf = (it: Item) => shownMetrics(it.task?.metrics.filter((m) => m.repeats) ?? []);
	const inRows = (it: Item) => repeatingOf(it).length > 0;
	/** Tasks whose parts repeat: one place each, with its rounds as rows and its parts as their stations. */
	const circuits = $derived(quickMode ? new Map<number, Circuit>() : circuitsOf(items.map((it) => ({ path: it.path, kids: it.kids, inRows: inRows(it) }))));
	const stationIn = $derived(new Set([...circuits.values()].flatMap((c) => c.rounds.flat())));
	/** A station is done: its tick, its sets, or a value you gave or left as it was with its tick. */
	function answered(j: number): boolean {
		const s = log[j];
		if (isYesNo(items[j])) return !!s.tick;
		return inRows(items[j]) ? s.sets.length > 0 && s.sets.every((x) => x.done) : (s.kept ?? hasLog(s, starts[j]));
	}
	const isPlace = (i: number) => !stationIn.has(i) && (inRows(items[i]) || circuits.has(i));
	const rowsAt = (i: number): RowState[] => circuits.get(i)?.rounds.map((r) => ({ done: r.every(answered), values: {} })) ?? log[i].sets;
	const wordsAt = (i: number) => {
		const t = items[i].task!;
		return circuits.has(i) ? roundWords(t) : { one: t.rowOne, many: t.rowMany };
	};
	/** What a station holds, in words. */
	const stationText = (j: number) =>
		[rowsText(repeatingOf(items[j]) as Field[], log[j].sets), ...(items[j].task?.metrics ?? []).filter((m) => !m.repeats && !isLong(m)).map((m) => valueText(m as Field, log[j].summary[m.id]))].filter(Boolean).join(' · ');
	function markStation(j: number, on: boolean) {
		const s = places[placeKey(items[j])];
		if (isYesNo(items[j])) s.tick = on;
		for (const x of s.sets) x.done = on;
		// Its once-only values go with its tick, beside its rows too.
		if (items[j].task?.metrics.some((m) => !m.repeats)) s.kept = on;
	}
	/** One press for a whole round. A number changed in it goes on to the rounds still to do. */
	function markRound(c: Circuit, r: number, on: boolean) {
		c.rounds[r].forEach((j, station) => {
			// What a station was answered with already stays as it is.
			if (on !== answered(j)) markStation(j, on);
			if (!on) return;
			const keys = c.rounds.map((x) => placeKey(items[x[station]]));
			places[keys[r]].sets.forEach((_, k) => {
				const rows = keys.map((key) => places[key].sets[k]);
				const start = keys.map((key) => base[key]?.sets[k]);
				if (rows.some((x) => !x) || start.some((x) => !x)) return;
				follow(rows, start as RowState[], r, metricsOf(items[j])).forEach((x, n) => (places[keys[n]].sets[k] = x));
			});
		});
	}
	const runPlaces = $derived(items.flatMap((it, i) => (isPlace(i) ? [{ key: placeKey(it), sets: rowsAt(i), i }] : [])));
	const row = $derived(stage === 'run' ? cursor(runPlaces, at, here) : at);
	const setsLeft = $derived(runPlaces.some((p) => p.sets.some((x) => !x.done)));
	/** Sets done before a swap are still this log's: a swap never takes them off the count, and Finish saves them. */
	const doneElsewhere = $derived(items.reduce((n, it) => n + setsBefore(it), 0));
	const setsDone = $derived(doneElsewhere + runPlaces.reduce((n, p) => n + p.sets.filter((x) => x.done).length, 0));
	const setsAll = $derived(doneElsewhere + runPlaces.reduce((n, p) => n + p.sets.length, 0));
	/** The Tasks' own word for their rows, when they share one. */
	const shared = (words: string[], or: string) => (new Set(words).size === 1 ? words[0] : or);
	const oneWord = $derived(shared(runPlaces.map((p) => wordsAt(p.i).one), 'row'));
	const allWords = $derived(shared(runPlaces.map((p) => wordsAt(p.i).many), 'rows'));

	function show(key: string) {
		tick().then(() => document.querySelector(`[data-place="${CSS.escape(key)}"] .lg-open`)?.scrollIntoView({ block: 'nearest' }));
	}
	function openRow(i: number, set: number | null) {
		const key = placeKey(items[i]);
		here = key;
		at = set === null ? null : { key, set };
		if (set !== null) show(key);
	}
	function unfold(i: number) {
		const rows = rowsAt(i);
		const left = rows.some((x) => !x.done) && stage === 'run';
		openRow(i, left ? null : rows.length - 1);
		show(placeKey(items[i]));
	}
	const metricsOf = (it: Item) => repeatingOf(it) as Field[];

	function doneRow(i: number, set: number, keyboard: boolean) {
		const it = items[i];
		const key = placeKey(it);
		const c = circuits.get(i);
		if (c) markRound(c, set, true);
		else {
			log[i].sets[set].done = true;
			places[key].sets = follow(log[i].sets, baseOf(i)?.sets ?? [], set, metricsOf(it));
		}
		logged = { key, set };
		setTimeout(() => {
			if (logged?.key === key && logged.set === set) logged = null;
		}, LOGGED_MS);
		at = null;
		here = key;
		const next = cursor(runPlaces, null, key);
		// The last one stays open, so nothing that ends the log ever comes under the thumb.
		if (!next) at = { key, set };
		const toAt = next ? items.findIndex((x) => placeKey(x) === next.key) : -1;
		const to = toAt < 0 ? undefined : items[toAt];
		const toWord = to ? wordsAt(toAt).one : '';
		const nextName = to ? `${next!.key === key ? '' : `${to.task?.name}, `}${toWord} ${next!.set + 1}` : '';
		if (it.task?.restTimerEnabled && next && !data.past && stage === 'run') startRest(it.task.restTimerSeconds, `${toWord} ${next.set + 1} of ${to?.task?.name}`, `/log/${data.occurrence.id}`, it.task.betweenName);
		else endRest();
		const nextText = !next ? '' : circuits.has(toAt) ? '' : `, ${rowText(metricsOf(to!), places[next.key].sets[next.set].values)}`;
		said = `Logged ${wordsAt(i).one} ${set + 1}.${next ? ` Next: ${nextName}${nextText}.` : ` All ${allWords} are done.`}`;
		if (next && next.key !== key) {
			here = next.key;
			show(next.key);
			if (keyboard) tick().then(() => document.querySelector<HTMLElement>(`[data-place="${CSS.escape(next.key)}"] .lg-act`)?.focus());
		}
	}
	function tickRow(i: number, set: number, on: boolean) {
		const key = placeKey(items[i]);
		const c = circuits.get(i);
		if (c) markRound(c, set, on);
		else log[i].sets[set].done = on;
		if (on) {
			if (!c) places[key].sets = follow(log[i].sets, baseOf(i)?.sets ?? [], set, metricsOf(items[i]));
			const t = items[i].task;
			if (t?.restTimerEnabled && stage === 'run' && !data.past) startRest(t.restTimerSeconds, t.name, `/log/${data.occurrence.id}`, t.betweenName);
		} else {
			endRest();
			here = key;
			at = { key, set };
		}
		said = `${cap(wordsAt(i).one)} ${set + 1} ${on ? 'done' : 'not done'}.`;
	}
	/** Changing a number never logs it. */
	function setValue(i: number, set: number, id: string, v: unknown) {
		const x = log[i].sets[set];
		x.values[id] = v;
		if (!x.own?.includes(id)) x.own = [...(x.own ?? []), id];
		// Stepping the row keeps it open, also once it is the only one left.
		if (stage === 'run') at = { key: placeKey(items[i]), set };
		if (x.done) places[placeKey(items[i])].sets = follow(log[i].sets, baseOf(i)?.sets ?? [], set, metricsOf(items[i]));
	}
	/** The stations whose fields are open. */
	let stationOpen = $state<Record<string, boolean>>({});
	function setStation(j: number, set: number, id: string, v: unknown) {
		const x = places[placeKey(items[j])].sets[set];
		x.values[id] = v;
		if (!x.own?.includes(id)) x.own = [...(x.own ?? []), id];
	}
	function addSet(i: number) {
		const last = log[i].sets.at(-1);
		log[i].sets.push({ done: false, values: { ...(last?.values ?? {}) } });
	}
	function removeSet(i: number) {
		const gone = log[i].sets.pop();
		const key = placeKey(items[i]);
		at = null;
		if (gone)
			showToast(`Removed ${items[i].task?.rowOne} ${log[i].sets.length + 1} of ${items[i].task?.name}, for this log.`, () => {
				if (!mounted) return 'Open the log to put it back.';
				places[key].sets.push(gone);
			});
	}
	function tickAll() {
		for (const [i, it] of items.entries()) {
			const ids = it.task?.metrics.filter((m) => m.repeats).map((m) => m.id) ?? [];
			if (!stationIn.has(i)) for (const x of log[i].sets) if (ids.some((id) => !empty(x.values[id]))) x.done = true;
		}
		for (const c of circuits.values()) c.rounds.forEach((_, r) => markRound(c, r, true));
		at = null;
		endRest();
	}

	// How the places stand: one open and the others a line each, or all open. Kept per habit, in the account.
	let picked = $state<'current' | 'all' | null>(null);
	const layout = $derived(picked ?? data.logLayouts[data.habitId] ?? 'current');
	async function setLayout(v: string) {
		picked = v === 'all' ? 'all' : 'current';
		const { [data.habitId]: _, ...rest } = data.logLayouts;
		const why = await saveSetting({ logLayouts: v === 'all' ? { ...rest, [data.habitId]: 'all' } : rest }, () => ({ logLayouts: data.logLayouts }), `${data.habitName} shows ${v === 'all' ? 'all of its log open' : 'one open at a time'}.`);
		// Not saved: it stays as picked for this visit, and says so.
		if (why) return showError(why);
		picked = null;
	}

	/** Correcting a finished log: one Undo per visit, back to what it was. It works from any page. */
	const was = untrack(() => ({ payload: data.occurrence.status === 'done' ? payload(true, true) : '', log: structuredClone($state.snapshot(places)), notes: data.occurrence.notes, level: data.occurrence.level, rev: data.rev }));
	let offered = false;
	let mounted = true;
	$effect(() => () => {
		mounted = false;
	});
	function offerUndo() {
		if (offered) return;
		offered = true;
		const { bases: _, ...rest } = JSON.parse(was.payload);
		const undo = undoWith(`/log/${data.occurrence.id}?/save`, { payload: JSON.stringify(rest) });
		showToast(`Changed the log of ${data.habitName}, ${dateLabel}.`, async () => {
			if (mounted) dropAutosave();
			if (!(await undo())) return false;
			offered = false;
			if (!mounted) return true;
			Object.assign(places, structuredClone(was.log));
			notes = was.notes;
			level = was.level;
			bases = [was.rev, revOf(JSON.parse(was.payload) as LogContent)];
			primed = false;
			return true;
		});
	}

	/**
	 * The value is still the prefill (last time or the target), not something logged now. It is
	 * compared with the prefill itself, so an autosave and a reload don't turn it into time logged.
	 */
	const isPrefill = (i: number, id: string) => isOpen && !!starts[i] && isSuggestion(log[i], starts[i], id);

	/** Something is logged already: Same as last fills in only the rest. */
	const started = $derived(items.some((it, i) => it.saved.length || log[i]?.sets.some((x) => x.done) || log[i]?.tick));

	async function sameAsLast() {
		// What is ticked here is saved first, so it is kept.
		const pending = saveTimer !== undefined;
		dropAutosave();
		// Refused: filling and finishing the server's copy would lose what is here.
		if ((pending || started) && (await autosave()).kind === 'refused') return;
		if (data.past) return sameAsLastPast();
		const a = await save('/?/same', [['occurrence', data.occurrence.id]], data.habitName);
		if (a.kind === 'refused') {
			if (a.to) return goto(a.to);
			problem = `Not saved. ${a.why}`;
			return;
		}
		clearDraft();
		if (a.kind === 'later') {
			showToast(`Logged ${data.habitName}. It will sync when you're back online.`);
			return goto(data.back);
		}
		goto(`${data.back.startsWith('/log/') ? data.back : '/'}?did=${data.occurrence.id}${started ? '' : '&clear=1'}`);
	}

	/** A past day: copy the last log from before that day, then go back to the day. */
	async function sameAsLastPast() {
		try {
			const res = await postAction(`/day/${data.occurrence.date}?/same`, { habit: data.habitId });
			const r = await res.json();
			if (r.type === 'redirect') return goto(r.location);
			if (r.type !== 'success') throw new Error('refused');
		} catch {
			problem = 'Could not save. Try again.';
			return;
		}
		clearDraft();
		goto(`${data.back}${data.back.includes('?') ? '&' : '?'}did=${data.occurrence.id}`);
	}

	const canRepeat = $derived(isOpen && items.some((it) => it.previous.length));

	const dateLabel = $derived(
		new Date(data.occurrence.date + 'T12:00:00').toLocaleDateString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		})
	);

	/** One day's scope, said one way: "today only", or a past open day's "Tue 18 Nov only". */
	const oneDay = $derived(data.past ? `${dateLabel} only` : 'today only');

	const LIST = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
	const recapOf = (id: string, best = false) => {
		const rc = data.recap[id];
		return rc ? `Last time ${LIST.format(new Date(rc.date + 'T12:00:00'))} · ${rc.text}${best && rc.best ? ` · best ${rc.best}` : ''}` : stage === 'run' ? 'First time' : '';
	};
	const headOf = (it: Item, i: number) => {
		const t = it.task!;
		const c = circuits.get(i);
		if (c) return [insteadOf(it), `${c.rounds.length} ${wordsAt(i).many}`, ...new Set(c.rounds[0].map((j) => items[j].task?.name ?? ''))].filter(Boolean).join(' · ');
		const n = log[i].sets.length;
		const targets = repeatingOf(it).flatMap((m) => {
			const v = targetAt(it, m.id);
			return v === undefined ? [] : [`${v} ${m.unit ?? m.name.toLowerCase()}`];
		});
		const rest = t.restTimerEnabled ? `${t.betweenName.toLowerCase()} ${t.restTimerSeconds % 60 ? `${t.restTimerSeconds} s` : `${t.restTimerSeconds / 60} min`}` : '';
		return [insteadOf(it), `${n} ${n === 1 ? t.rowOne : t.rowMany}`, ...targets, rest].filter(Boolean).join(' · ');
	};
	const foldedAt = (i: number) => {
		const it = items[i];
		if (quickMode || layout === 'all' || !isPlace(i)) return false;
		return row ? row.key !== placeKey(it) : stage === 'correct' || runPlaces.length > 1;
	};
	// ----- Edit: names, order and the plan's numbers, from now on; a row's place, for this log -----

	let mode = $state<Mode>('use');
	const canEdit = $derived(stage === 'run' && !data.past && !quickMode && !!data.plan);
	const editing = $derived(canEdit && mode === 'edit');
	const editPlaces = $derived.by((): EditPlace[] => {
		const out: (EditPlace & { at: number[] })[] = [];
		items.forEach((it, i) => {
			const g = out.find((x) => x.id === it.slotId);
			if (g) return void g.at.push(i);
			out.push({ id: it.slotId, name: it.task?.name ?? 'No matching Task', task: it.task?.id ?? null, replace: null, numbers: [], rows: [], at: [i] });
		});
		for (const g of out) {
			const it = items[g.at[0]];
			const s = slotIn(data.plan ?? [], g.id);
			const t = it.task;
			if (s?.taskId && !s.fillRule) g.replace = nameOf(s.taskId) ?? null;
			if (s && t && (inRows(it) || s.sets)) {
				const n = inRows(it) ? log[g.at[0]].sets.length : s.sets!;
				const w = inRows(it) || !it.kids ? { one: t.rowOne, many: t.rowMany } : roundWords(t);
				g.numbers.push({ id: '', label: cap(w.many), text: `${n} ${n === 1 ? w.one : w.many}` });
			}
			// A Task swapped in for this log has no targets of its own in the plan.
			if (s && t && s.taskId === t.id)
				for (const m of t.metrics.filter((x) => isNumeric(x) && s.targets[x.id] !== undefined)) g.numbers.push({ id: m.id, label: m.name, text: `${s.targets[m.id]} ${m.unit || m.name.toLowerCase()}` });
			// The clock between rows is the Task's, everywhere.
			if (t && (inRows(it) || it.kids)) g.numbers.push({ id: 'pause', label: t.betweenName, text: t.restTimerEnabled ? `${t.betweenName.toLowerCase()} ${t.restTimerSeconds} s` : `no ${t.betweenName.toLowerCase()}` });
			// The rounds of a circuit keep their order.
			if (g.at.length === 1 || !g.at.some((i) => items[i].roundHead || items[i].path.includes('#')))
				for (const i of g.at) {
					const x = items[i];
					if (x.task && inRows(x) && log[i].sets.length > 1)
						g.rows.push({ key: placeKey(x), name: x.task.name, one: x.task.rowOne, many: x.task.rowMany, fields: repeatingOf(x) as Field[], sets: log[i].sets, previous: x.previous.filter((v) => !isSummary(v)) });
				}
		}
		return out;
	});
	const patch = async (url: string, set: object, was: object) => {
		const res = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ set, was }) }).catch(() => null);
		return res ? { ok: res.ok, why: res.ok ? '' : String((await res.json().catch(() => ({}))).error ?? '') } : null;
	};
	/** Change the plan or a Task, say so, and take it back exactly. `local` is what it does to this log. */
	async function edit(url: string, set: object, was: object, words: string, local?: (back: boolean) => void) {
		const a = await patch(url, set, was);
		if (!a) return void showError('Not saved. Are you online?', () => void edit(url, set, was, words, local));
		if (!a.ok) {
			showError(a.why || 'Not saved.');
			return void invalidateAll();
		}
		local?.(false);
		await invalidateAll();
		showToast(words, async () => {
			const b = await patch(url, was, set);
			if (!b) return false;
			if (!b.ok) return b.why || false;
			if (mounted) local?.(true);
			return true;
		});
	}
	const editPlan = (next: Plan, words: string, local?: (back: boolean) => void) => edit(`/api/habits/${data.habitId}`, { variants: next }, { variants: data.plan }, words, local);
	function editOrder(order: string[], moved: string) {
		const name = editPlaces.find((p) => p.id === moved)?.name;
		void editPlan(inOrder(data.plan!, order), `Moved ${name} to ${order.indexOf(moved) + 1} of ${order.length} in ${data.habitName}, from now on.`);
	}
	function editName(p: EditPlace, name: string) {
		void edit(`/api/tasks/${p.task}`, { name }, { name: p.name }, `Renamed ${p.name} to ${name}, everywhere.`);
	}
	function editNumber(p: EditPlace, id: string, n: number) {
		const i = items.findIndex((it) => it.slotId === p.id);
		const it = items[i];
		const key = placeKey(it);
		const s = slotIn(data.plan!, p.id)!;
		if (id === 'pause') {
			const t = it.task!;
			const was = { restTimerEnabled: t.restTimerEnabled, restTimerSeconds: t.restTimerSeconds };
			const seconds = Math.min(3600, Math.round(n));
			const set = seconds ? { restTimerEnabled: true, restTimerSeconds: seconds } : { restTimerEnabled: false, restTimerSeconds: t.restTimerSeconds };
			if (JSON.stringify(set) === JSON.stringify(was)) return;
			return void edit(`/api/tasks/${t.id}`, set, was, seconds ? `${t.betweenName} after ${t.rowMany} of ${p.name} is ${seconds} s now, everywhere.` : `No ${t.betweenName.toLowerCase()} after ${t.rowMany} of ${p.name} any more.`);
		}
		if (!id) {
			const count = Math.max(1, Math.round(n));
			const rows = [...(places[key]?.sets ?? [])];
			const w = inRows(it) || !it.kids ? { one: it.task!.rowOne, many: it.task!.rowMany } : roundWords(it.task!);
			const word = count === 1 ? w.one : w.many;
			if (count === rows.length && count === s.sets) return;
			return void editPlan(withSlot(data.plan!, p.id, { sets: count }), `Set ${p.name} to ${count} ${word} for ${data.habitName}, from now on.`, (back) => {
				if (inRows(it)) places[key].sets = back ? (places[key].sets.length === count ? rows : places[key].sets) : toCount(places[key].sets, count);
				at = null;
			});
		}
		const m = it.task!.metrics.find((x) => x.id === id)!;
		const before = s.targets[id];
		if (n === before) return;
		void editPlan(withSlot(data.plan!, p.id, { targets: { ...s.targets, [id]: n } }), `Set ${p.name} to ${n} ${m.unit || m.name.toLowerCase()} for ${data.habitName}, from now on.`, (back) => {
			// Rows still to do that start from the target follow it, unless their number was changed here.
			if (m.prefill !== 'target') return;
			const [from, to] = back ? [n, before] : [before, n];
			for (const x of places[key].sets) if (!x.done && !x.own?.includes(id) && x.values[id] === from) x.values[id] = to;
			if (!m.repeats && places[key].summary[id] === from) places[key].summary[id] = to;
		});
	}
	/** Out of the plan, from now on. A log that has values in it keeps it. */
	function editRemove(p: EditPlace) {
		if (!slotIn(data.plan!, p.id)) return void showToast(`${p.name} is not in the plan any more. This log keeps it.`);
		const here = items.some((it, i) => it.slotId === p.id && hasLog(log[i], starts[i]));
		// What is ticked here is saved first, so the log keeps its place.
		const gone = async () => {
			const first = await saveFirst();
			if (first.kind !== 'saved') return void showError(first.kind === 'refused' ? first.why : 'Not saved. Are you online?');
			await editPlan(withoutSlot(data.plan!, p.id), `Took ${p.name} out of ${data.habitName}, from now on.${here ? ' This log keeps it.' : ''}`);
		};
		void gone();
	}
	/** Replace…: another Task in a fixed Slot, from now on, as Keep in the plan does. */
	async function editReplace(slot: string, task: string) {
		const r = await keepInPlan(slot, task);
		if (typeof r === 'string') showError(r);
	}
	function editAdd(task: string) {
		const name = data.library.find((l) => l.id === task)?.name;
		void editPlan(withTask(data.plan!, data.variantId!, crypto.randomUUID(), task), `Added ${name} to ${data.habitName}, from now on.`);
	}
	function editRows(key: string, rows: RowState[], moved: RowState) {
		const before = [...places[key].sets];
		const it = items.find((x) => placeKey(x) === key)!;
		places[key].sets = rows;
		at = null;
		showToast(`Moved ${it.task!.rowOne} ${before.indexOf(moved) + 1} of ${it.task!.name} to ${rows.indexOf(moved) + 1} of ${rows.length}, for this log.`, () => {
			if (!mounted) return 'Open the log to move it back.';
			const now = places[key].sets;
			places[key].sets = [...before.filter((x) => now.includes(x)), ...now.filter((x) => !before.includes(x))];
			at = null;
		});
	}

	/** The Task swapped in is the one open, and focus goes back to its ⋯, where the swap was made. */
	async function openSwapped(slot: string) {
		const now = items.find((x) => x.slotId === slot && x.depth === 0);
		if (!now) return;
		here = placeKey(now);
		at = null;
		await tick();
		document.querySelector<HTMLElement>(`[data-place="${CSS.escape(here)}"] .lg-more`)?.focus();
	}
	/**
	 * Use another Task in a place's Slot for this log, or with none named, pick another for an
	 * auto-filled Slot. What is ticked is saved first, so it is kept; offline both wait, in order.
	 */
	async function swapTask(it: Item, task?: string) {
		if (task && task === it.task?.id) return;
		const first = await saveFirst();
		if (first.kind === 'refused') return void showError(`${first.why} Nothing was swapped.`);
		// What was still to do here, for a Task swapped in that has no last time of its own.
		const was = it.task;
		if (was) carried = { ...carried, [it.slotId]: { id: was.id, from: was.name, fields: was.metrics.filter((m) => m.repeats), rows: (places[placeKey(it)]?.sets ?? []).filter((x) => !x.done).map((x) => ({ ...x.values })) } };
		const url = `/log/${data.occurrence.id}?/swap`;
		const label = data.habitName;
		const a = await save(task ? url : `/log/${data.occurrence.id}?/reroll`, task ? [['slot', it.slotId], ['task', task]] : [['slot', it.slotId]], label);
		if (a.kind === 'refused') return void showError(a.why);
		const how = !task ? 'reroll' : task === it.own ? 'back' : 'swap';
		// Undo swaps back to the Task it showed before (an auto-filled Slot that had none: none again), saving what is
		// ticked first as a swap does.
		const back = was?.id ?? (it.open ? '' : null);
		const undo = back !== null
			? async () => {
					if (mounted) {
						const first = await saveFirst();
						if (first.kind === 'refused') return `${first.why} Nothing was swapped.`;
					}
					const b = await save(url, [['slot', it.slotId], ['task', back]], label);
					if (b.kind === 'refused') return b.why;
					// The place it puts back is the one open again.
					if (mounted) {
						here = placeKey({ path: it.path, task: was });
						at = null;
					}
					return true;
				}
			: undefined;
		// A Task swapped into a fixed Slot can stay there, from now on. Offline, Keep says it isn't saved, with Retry.
		const keep = task && how === 'swap' && keepable(it.slotId) ? { label: 'Keep in the plan', run: () => keepInPlan(it.slotId, task) } : undefined;
		// Offline it waits, and the place shows it at once when this page holds the Task's fields (see `items`).
		if (a.kind === 'later') {
			const name = data.library.find((l) => l.id === task)?.name;
			showToast(`${name ? swapText(was?.name ?? null, name, how, oneDay) : `Picking another Task, ${oneDay}.`} It will sync when you're back online.`, undo, undefined, keep);
			return void openSwapped(it.slotId);
		}
		await invalidateAll();
		const now = items.find((x) => x.slotId === it.slotId && x.depth === 0);
		showToast(swapText(was?.name ?? null, now?.task?.name ?? 'another Task', how, oneDay), undo, undefined, keep);
		await openSwapped(it.slotId);
	}
	/** A fixed Slot of the plan this log can change (today's open log): a Task swapped in there can be kept. */
	function keepable(slot: string) {
		const s = data.plan && slotIn(data.plan, slot);
		return !!s?.taskId && !s.fillRule;
	}
	/**
	 * Keep in the plan: a Task becomes its fixed Slot's own in this Variant, from now on, with the Slot's place and sets,
	 * aiming for what it did here today, else its last time (see aimFor). One plan change: its Undo puts the Slot back
	 * exactly, and today stays on the Task it shows. Offline: "Not saved. Are you online?" with Retry.
	 */
	async function keepInPlan(slot: string, task: string): Promise<string | void> {
		if (!mounted) return 'Open the log to keep it in the plan.';
		const s = data.plan && slotIn(data.plan, slot);
		if (!s?.taskId || s.fillRule) return 'Not kept: that Slot is not in the plan any more.';
		if (s.taskId === task) return;
		const at = items.find((x) => x.slotId === slot && x.depth === 0);
		// With no swap today the place follows the plan and changes too (Replace…): what is ticked is saved first, as Remove does.
		if (at?.task?.id === s.taskId) {
			const first = await saveFirst();
			if (first.kind !== 'saved') return void showError(first.kind === 'refused' ? first.why : 'Not saved. Are you online?', first.kind === 'refused' ? undefined : () => void keepInPlan(slot, task));
		}
		// What it did in this Slot today: in its place, and before a swap took it away.
		const today = loggedAt([...items.flatMap((it, i) => entriesAt(it, i, false)), ...elsewhere()], task, at?.path ?? slot);
		const a = await runAction<{ targets: Record<string, number>; aim: string }>(`/log/${data.occurrence.id}?/aim`, { slot, task, today: JSON.stringify(today) });
		if (!a.ok || !a.data) return void showError(a.error ?? 'Not saved. Are you online?', () => void keepInPlan(slot, task));
		// The plan as it stands now: it may have loaded again while that was on its way.
		const plan = data.plan;
		const was = plan && slotIn(plan, slot);
		if (!plan || !was?.taskId || was.fillRule) return 'Not kept: that Slot is not in the plan any more.';
		const variant = plan.find((v) => v.slots.some((x) => x.id === slot))?.name ?? data.variantName ?? '';
		await editPlan(withSlot(plan, slot, { taskId: task, targets: a.data.targets, minTargets: {}, stretchTargets: {} }), keptText(nameOf(was.taskId) ?? "the plan's Task", nameOf(task) ?? 'another Task', variant, a.data.aim));
	}
	/** The swap picker, for a place, and what had focus before it, to go back to. `plan`: Replace… in Edit, from now on. */
	let picking = $state<{ it: Item; from: HTMLElement | null; plan?: boolean } | null>(null);
	const nameOf = (id: string) => data.library.find((l) => l.id === id)?.name ?? data.alts[id]?.task.name;
	const dayText = (date: string) => LIST.format(new Date(date + 'T12:00:00'));
	/** "Instead of Bench press, today only": a fixed Slot whose Task is swapped for this log. */
	const insteadOf = (it: Item) => (it.depth === 0 && it.own && it.task && it.task.id !== it.own ? `Instead of ${nameOf(it.own) ?? 'the plan\'s Task'}, ${oneDay}` : '');
	let howTo = $state<string | null>(null);
	let finishButton = $state<HTMLButtonElement>();
	function goToFinish() {
		finishButton?.scrollIntoView({ block: 'center' });
		finishButton?.focus({ preventScroll: true });
	}
	function menuOf(it: Item): (Way | '-')[] {
		const key = placeKey(it);
		const info: Way[] = [
			...(it.task?.notes.trim() ? [{ label: howTo === key ? 'Hide how to' : 'How to', onselect: () => (howTo = howTo === key ? null : key) }] : []),
			...(it.task ? [{ label: 'Last 7 times', href: `/library/${it.task.id}` }] : [])
		];
		const swaps = stage === 'run' && it.depth === 0 ? swapWays(it) : [];
		return [...info, ...(info.length && swaps.length ? ['-' as const] : []), ...swaps];
	}
	/** The swap's one home: the plan's Task, the one in use (ticked) and up to 2 used here before, then the picker. */
	function swapWays(it: Item): (Way | '-')[] {
		const more: Way = { label: 'Swap for another…', onselect: () => (picking = { it, from: document.activeElement as HTMLElement | null }) };
		// An auto-filled Slot has no Task of its own: it picks again from its Fill rule.
		if (!it.own) return [...(it.open ? [{ label: 'Pick another', onselect: () => void swapTask(it) }] : []), more];
		const own = it.own;
		const now = it.task?.id;
		const plan = nameOf(own);
		return [
			...(plan ? [{ label: plan, value: 'In the plan', checked: now === own, onselect: () => void swapTask(it, own) }] : []),
			...(it.task && now !== own ? [{ label: it.task.name, value: cap(oneDay), checked: true }] : []),
			...it.used
				.filter((u) => u.taskId !== now && nameOf(u.taskId))
				.slice(0, 2)
				.map((u) => ({ label: nameOf(u.taskId)!, value: usedText(u, dayText), checked: false, onselect: () => void swapTask(it, u.taskId) })),
			more,
			// Later in the visit, as the band's Keep in the plan.
			...(it.task && now !== own && keepable(it.slotId) ? ['-' as const, { label: `Keep ${it.task.name} in the plan`, onselect: () => void keepInPlan(it.slotId, now!) }] : [])
		];
	}
	const hint = $derived(
		[
			data.variantName,
			data.past && isOpen ? `for ${dateLabel}` : dateLabel,
			data.occurrence.status !== 'due' ? data.occurrence.status : null,
			setsAll ? `${setsDone} of ${setsAll} ${allWords} done` : null,
			data.past && isOpen
				? 'Kept on this device, not counted until you finish'
				: { idle: correcting ? 'Saves as you change it' : null, saving: 'Saving…', saved: 'Saved', local: 'Saved on this device', refused: 'Not saved' }[saveState]
		]
			.filter(Boolean)
			.join(' · ')
	);

	const prevSummary = (i: number) => items[i].previous.find(isSummary) ?? {};
	const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v));
	const stepOf = (m: Metric) => m.step ?? defaultStep(m.type, m.unit, units());
	const isNumeric = (m: Metric) => m.type === 'number' || m.type === 'count' || m.type === 'duration';
	/** Required fields always show, so a quick log can always be finished. */
	function shownMetrics(ms: Metric[]) {
		return quickMode ? ms.filter((m) => m.quick || m.required) : ms;
	}
</script>

<svelte:head><title>{data.habitName} · ittracks</title></svelte:head>
<svelte:window onkeydown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && stage === 'run' && finishForm?.requestSubmit()} />

<EditChrome title={quickMode ? `Quick log: ${data.habitName}` : data.habitName} back={{ href: data.back, label: backLabel(data.back) }} bind:mode modes={canEdit ? ['use', 'edit'] : ['use']} hints={{ use: hint, edit: 'Drag ⠿ to move. What you change, add or remove here is the plan, from now on.' }} />
{#if saveState === 'refused' && !theirs}<p class="error" role="alert">Not saved: {refusedWhy}</p>{/if}
<p class="vh" role="status">{said}</p>

{#if stage === 'read'}
	<div class="notice"><span class="notice-text">This day is further back than Settings allow logging, so it can only be looked at.</span><span class="notice-acts"><a class="quiet" href="/settings#past">Change it in Settings</a></span></div>
{/if}

<div class="l-cluster lg-top">
	{#if data.levels && !quickMode}
		<div class="lg-level" role="group" aria-label="Level">
			<div class="chips">
				{#each ['minimum', 'target', 'stretch'] as const as l (l)}
					<button type="button" class="toggle" aria-pressed={level === l} disabled={stage === 'read'} onclick={() => (level = l)}>{levelNames[l]}</button>
				{/each}
			</div>
			{#if data.levels[level]}<p class="meta">{data.levels[level]}</p>{/if}
		</div>
	{/if}
	{#if runPlaces.length > 1 && !quickMode}
		<label class="lg-layout meta">Layout <select value={layout} onchange={(e) => setLayout(e.currentTarget.value)}><option value="current">One open</option><option value="all">All open</option></select></label>
	{/if}
</div>

{#snippet onceFields(it: Item, i: number, metrics: Metric[])}
	{#each metrics as m (m.id)}
		{@const prev = prevSummary(i)[m.id]}
		{@const unit = m.unit || (m.type === 'duration' ? 'min' : '')}
		<div class="field">
			{#if m.type === 'checkbox'}
				<label class="check"><input type="checkbox" class="tick" disabled={stage === 'read'} checked={!!log[i].summary[m.id]} onchange={(e) => setOnce(i, m.id, e.currentTarget.checked)} /> {m.name}{m.required ? ', required' : ''}</label>
			{:else if m.type === 'choice' && (m.choices?.length ?? 0) <= 7}
				<span class="label">{m.name}{m.required ? ', required' : ''}</span>
				{#if isPrefill(i, m.id)}<span class="meta">{log[i].summary[m.id] === prev ? 'As last time' : 'Target'}. Tap it to keep it.</span>{/if}
				<div class="chips" role="group" aria-label={m.name}>
					{#each m.choices ?? [] as c (c.id)}
						<button type="button" class="toggle" disabled={stage === 'read'} aria-pressed={log[i].summary[m.id] === c.id} onclick={() => pickChip(i, m.id, c.id)}>{c.name}</button>
					{/each}
				</div>
			{:else if m.type === 'choice'}
				<label class="label" for="f-{i}-{m.id}">{m.name}{m.required ? ', required' : ''}</label>
				<select id="f-{i}-{m.id}" disabled={stage === 'read'} value={num(log[i].summary[m.id])} onchange={(e) => setOnce(i, m.id, e.currentTarget.value)}>
					<option value=""></option>
					{#each m.choices ?? [] as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
				</select>
			{:else if m.type === 'text' && isLong(m) && stage === 'read'}
				<span class="label">{m.name}</span><Markdown text={num(log[i].summary[m.id])} small />
			{:else if m.type === 'text' && isLong(m)}
				<NoteBox
					label="{m.name}{m.required ? ', required' : ''}"
					placeholder="Write here. Markdown works."
					rows={6}
					bind:value={() => num(log[i].summary[m.id]), (v) => setOnce(i, m.id, v)}
				/>
			{:else if m.type === 'text'}
				<label class="label" for="f-{i}-{m.id}">{m.name}{m.required ? ', required' : ''}</label>
				<input id="f-{i}-{m.id}" disabled={stage === 'read'} value={num(log[i].summary[m.id])} oninput={(e) => setOnce(i, m.id, e.currentTarget.value)} />
			{:else if isNumeric(m)}
				<span class="label">{m.name}{unit ? ` (${unit})` : ''}{m.required ? ', required' : ''}</span>
				<NumberField
					value={log[i].summary[m.id] as number | null}
					step={stepOf(m)}
					{unit}
					label="{m.name} for {it.task?.name}"
					disabled={stage === 'read'}
					caption={[targetAt(it, m.id) !== undefined ? `${data.levels ? levelNames[level] : 'Target'} ${targetAt(it, m.id)}` : '', prev !== undefined && isOpen ? `last time ${prev}` : ''].filter(Boolean).join(' · ')}
					onchange={(v) => setOnce(i, m.id, v)}
				/>
				{#if m.type === 'duration' && !quickMode && !data.past && stage === 'run'}
					<Timer
						bind:value={() => log[i].summary[m.id] as number | null, (v) => setOnce(i, m.id, v)}
						replace={isPrefill(i, m.id)}
						target={targetAt(it, m.id) ?? null}
						storageKey="timer:{data.occurrence.id}:{m.id}"
					/>
				{/if}
			{/if}
		</div>
	{/each}
{/snippet}

{#snippet stations(c: Circuit, k: number, word: string)}
	<ul class="elist lg-stations" data-mode="use" style="--gap: 0px; --depth: 1" aria-label="In {word} {k + 1}">
		{#each c.rounds[k] as j (placeKey(items[j]))}
			{@const x = items[j]}
			{@const t = x.task}
			{@const key = placeKey(x)}
			{@const single = t?.metrics.filter((m) => !m.repeats) ?? []}
			<li class="row lg-row" class:done={answered(j)}>
				<div class="card link">
					<span class="slot"></span>
					<div class="content">
						{#if isYesNo(x)}<label class="lg-tick-label" for="st-{key}">{t?.name}</label>
						{:else}
							<button type="button" class="lg-bare lg-press lg-station" aria-expanded={!!stationOpen[key]} onclick={() => (stationOpen[key] = !stationOpen[key])}
								><span class="lg-press-text"><span class="lg-station-name">{t?.name}</span> <span class="label"><bdi dir="ltr">{stationText(j)}</bdi></span></span></button
							>
						{/if}
					</div>
					<div class="verb"><input id="st-{key}" type="checkbox" class="tick hit" disabled={stage === 'read'} checked={answered(j)} aria-label="{t?.name}, {word} {k + 1}, done" onchange={(e) => markStation(j, e.currentTarget.checked)} /></div>
				</div>
				{#if t && stationOpen[key]}
					<div class="lg-station-fields">
						{#each log[j].sets as row, n (n)}
							<div class="lg-fields lg-regular">
								{#each repeatingOf(x) as m (m.id)}
									<div class="field">
										{#if m.type === 'checkbox'}<label class="check"><input type="checkbox" class="tick" disabled={stage === 'read'} checked={!!row.values[m.id]} onchange={(e) => setStation(j, n, m.id, e.currentTarget.checked)} /> {m.name}</label>
										{:else if m.type === 'choice'}<label class="label" for="st-{key}-{n}-{m.id}">{m.name}</label><select id="st-{key}-{n}-{m.id}" disabled={stage === 'read'} value={num(row.values[m.id])} onchange={(e) => setStation(j, n, m.id, e.currentTarget.value || null)}><option value=""></option>{#each m.choices ?? [] as o (o.id)}<option value={o.id}>{o.name}</option>{/each}</select>
										{:else if isNumeric(m)}<span class="label">{m.name}{m.unit ? ` (${m.unit})` : ''}</span><NumberField value={row.values[m.id] as number | null} step={stepOf(m)} unit={m.unit ?? ''} label="{m.name} for {t.name}, {word} {k + 1}" disabled={stage === 'read'} onchange={(v) => setStation(j, n, m.id, v)} />
										{:else}<label class="label" for="st-{key}-{n}-{m.id}">{m.name}</label><input id="st-{key}-{n}-{m.id}" disabled={stage === 'read'} value={num(row.values[m.id])} oninput={(e) => setStation(j, n, m.id, e.currentTarget.value)} />{/if}
									</div>
								{/each}
							</div>
						{/each}
						{#if single.length}{@render onceFields(x, j, single)}{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet extraOf(it: Item)}
	{@const t = it.task}
	{#each doneLines(it) as line}<p class="meta-line">{line}</p>{/each}
	{#if t && howTo === placeKey(it)}<div class="howto"><Markdown text={t.notes} small /></div>{/if}
{/snippet}

{#if editing}
	<EditPlaces places={editPlaces} open={items.find((it) => placeKey(it) === row?.key)?.slotId ?? null} onorder={editOrder} onname={editName} onnumber={editNumber} onrows={editRows} onremove={editRemove} onadd={editAdd} onreplace={(p) => (picking = { it: items.find((x) => x.slotId === p.id && x.depth === 0)!, from: document.activeElement as HTMLElement | null, plan: true })} library={data.library.filter((l) => !l.archived)} />
{:else}
<ul class="elist lg-page lg-places" data-mode="use" aria-label="What to log">
	{#each items as it, i (placeKey(it))}
		{@const t = it.task}
		{@const key = placeKey(it)}
		{@const single = t ? shownMetrics(t.metrics.filter((m) => !m.repeats)) : []}
		{#if stationIn.has(i)}<!-- in its round -->{:else}
		{#if it.roundHead && !quickMode}<li class="lg-heading"><h2 class="card-title">{it.roundHead}</h2></li>{/if}
		{#if t && isYesNo(it)}
			{#if !quickMode}
				<li class="row lg-row" class:done={log[i].tick} style:margin-inline-start="calc({it.depth} * var(--space-indent))">
					<div class="card">
						<span class="slot"></span>
						<div class="content"><label class="lg-tick-label" for="tick-{i}">{t.name}</label>{#if insteadOf(it)}<p class="meta-line">{insteadOf(it)}</p>{/if}{@render extraOf(it)}</div>
						<div class="verb">
							<input id="tick-{i}" type="checkbox" class="tick hit" disabled={stage === 'read'} bind:checked={log[i].tick} aria-label="{t.name} done" />
							{#if menuOf(it).length && stage === 'run'}<MenuButton class="quiet glyph lg-more" label="More for {t.name}" items={menuOf(it)} />{/if}
						</div>
					</div>
				</li>
			{/if}
		{:else if !t || !quickMode || shownMetrics(t.metrics).length}
			<li class="holder lg-place" class:lg-folded={foldedAt(i)} class:lg-folds={foldedAt(i)} class:done={isPlace(i) && rowsAt(i).length > 0 && rowsAt(i).every((x) => x.done)} data-place={key} style:margin-inline-start="calc({it.depth} * var(--space-indent))">
				{#if t && circuits.has(i)}
					{@const c = circuits.get(i)!}
					<Place
						name={t.name}
						words={wordsAt(i)}
						fields={[]}
						sets={rowsAt(i)}
						base={[]}
						previous={[]}
						head={headOf(it, i)}
						recap={stage === 'run' && !recapOf(t.id).startsWith('First') ? recapOf(t.id) : ''}
						open={row?.key === key ? row.set : null}
						folded={foldedAt(i)}
						{stage}
						toFinish={!setsLeft}
						logged={logged?.key === key ? logged.set : null}
						menu={menuOf(it)}
						targetOf={() => undefined}
						onopen={(k) => openRow(i, k)}
						onunfold={() => unfold(i)}
						ondone={(k, keyboard) => doneRow(i, k, keyboard)}
						ontick={(k, on) => tickRow(i, k, on)}
						onvalue={() => {}}
						onadd={() => {}}
						onremove={() => {}}
						onfinish={goToFinish}
						once={single.length ? onceHere : undefined}
						extra={extraHere}
						text={(k) => c.rounds[k].map(stationText).filter(Boolean).join(' · ')}
						body={stationsHere}
					/>
					{#snippet onceHere()}{@render onceFields(it, i, single)}{/snippet}
					{#snippet extraHere()}{@render extraOf(it)}{/snippet}
					{#snippet stationsHere(k: number)}{@render stations(c, k, wordsAt(i).one)}{/snippet}
				{:else if t && inRows(it) && !quickMode}
					<Place
						name={t.name}
						words={{ one: t.rowOne, many: t.rowMany }}
						fields={repeatingOf(it).map((m) => ({ ...m, step: stepOf(m) }))}
						sets={log[i].sets}
						base={baseOf(i)?.sets ?? []}
						previous={it.previous.filter((v) => !isSummary(v))}
						head={headOf(it, i)}
						recap={recapOf(t.id)}
						open={row?.key === key ? row.set : null}
						folded={foldedAt(i)}
						{stage}
						toFinish={!setsLeft}
						logged={logged?.key === key ? logged.set : null}
						menu={menuOf(it)}
						targetOf={(id) => targetAt(it, id)}
						carried={carriedTo(it)}
						onopen={(k) => openRow(i, k)}
						onunfold={() => unfold(i)}
						ondone={(k, keyboard) => doneRow(i, k, keyboard)}
						ontick={(k, on) => tickRow(i, k, on)}
						onvalue={(k, id, v) => setValue(i, k, id, v)}
						onadd={() => addSet(i)}
						onremove={() => removeSet(i)}
						onfinish={goToFinish}
						once={single.length ? onceHere : undefined}
						extra={extraHere}
					/>
					{#snippet onceHere()}{@render onceFields(it, i, single)}{/snippet}
					{#snippet extraHere()}{@render extraOf(it)}{/snippet}
				{:else}
					<div class="card lg-head">
						<span class="slot"></span>
						<div class="content">
							<h2 class="name">{t?.name ?? 'No matching Task'}</h2>
							{#if insteadOf(it)}<p class="meta-line">{insteadOf(it)}</p>{/if}
							{#if !t}<p class="meta-line">Nothing in your <a href="/library">Library</a> matches this place's rules.</p>{:else if recapOf(t.id)}<p class="meta-line">{recapOf(t.id, true)}</p>{/if}
							{@render extraOf(it)}
						</div>
						{#if menuOf(it).length && stage === 'run' && !quickMode}<div class="verb"><MenuButton class="quiet glyph lg-more" label="More for {t?.name ?? 'this place'}" items={menuOf(it)} /></div>{/if}
					</div>
					{#if t}
						<div class="shelf lg-shelf">
							{#if quickMode && inRows(it)}
								{#each log[i].sets as x, k (k)}
									<div class="lg-once">
										<span class="label">{cap(t.rowOne)} {k + 1}</span>
										<div class="lg-fields">
											{#each repeatingOf(it) as m (m.id)}
												{#if isNumeric(m)}
													<div class="field">
														<span class="label">{m.name}{m.unit ? ` (${m.unit})` : ''}</span>
														<NumberField value={x.values[m.id] as number | null} step={stepOf(m)} unit={m.unit ?? ''} label="{m.name} for {t.name}, {t.rowOne} {k + 1}" onchange={(v) => (x.values[m.id] = v)} />
													</div>
												{:else if m.type === 'choice'}
													<label class="field"><span class="label">{m.name}</span>
														<select value={num(x.values[m.id])} onchange={(e) => (x.values[m.id] = e.currentTarget.value)}><option value=""></option>{#each m.choices ?? [] as c (c.id)}<option value={c.id}>{c.name}</option>{/each}</select></label>
												{:else if m.type === 'checkbox'}
													<label class="check"><input type="checkbox" class="tick" checked={!!x.values[m.id]} onchange={(e) => (x.values[m.id] = e.currentTarget.checked)} /> {m.name}</label>
												{:else}
													<label class="field"><span class="label">{m.name}</span><input value={num(x.values[m.id])} oninput={(e) => (x.values[m.id] = e.currentTarget.value)} /></label>
												{/if}
											{/each}
										</div>
									</div>
								{/each}
							{/if}
							{#if single.length}<div class="lg-once">{@render onceFields(it, i, single)}</div>{/if}
						</div>
					{/if}
				{/if}
			</li>
		{/if}
		{/if}
	{/each}
</ul>
{/if}

{#if picking}
	{@const p = picking}
	{@const plan = p.it.own && nameOf(p.it.own)}
	{@const like = plan ? { id: p.it.own!, name: plan } : p.it.task}
	<SwapSheet
		title={p.plan ? `Replace ${plan}` : like ? `Instead of ${like.name}` : 'A Task for this Slot'}
		groups={(query) => swapGroups({ library: data.library, used: p.it.used, like, current: p.plan ? p.it.own : (p.it.task?.id ?? null), query, day: dayText, away: (id) => !p.plan && !navigator.onLine && !onDevice(id)?.task })}
		onpick={(id) => void (p.plan ? editReplace(p.it.slotId, id) : swapTask(p.it, id))}
		onclose={() => {
			picking = null;
			p.from?.focus();
		}}
	/>
{/if}

<div class="lg-end" class:lg-editing={editing}>
	{#if items.length === 0}<p class="empty-first">Nothing to log here. Add Tasks to it in the habit's editor, or finish it as it is.</p>{/if}
	{#if data.orphanNames.length && !quickMode}
		<p class="notice"><span class="notice-text meta">This log also has values for {data.orphanNames.join(', ')}, which {data.orphanNames.length === 1 ? 'is' : 'are'} no longer in this habit. They are kept.</span></p>
	{/if}
	{#if quickMode}
		<p class="meta"><a href="/log/{data.occurrence.id}">Open the full log</a> to change anything else.</p>
	{:else}
		{#if stage === 'read'}{#if notes}<Markdown text={notes} small />{/if}{:else}<NoteBox bind:value={notes} label="Note" rows={2} />{/if}
	{/if}
	{#if problem}<div class="notice" data-tone="error" role="alert"><span class="notice-text">{problem}</span></div>{/if}
	{#if form?.error}<div class="notice" data-tone="error" role="alert"><span class="notice-text">{form.error}</span></div>{/if}
{#if theirs}
	<section class="card elsewhere" role="alert">
		<p>
			This log changed on another device{changed.length ? `: ${changed.join(', ')} ${changed.length === 1 ? 'is' : 'are'} different there` : ''}. Nothing here is saved over it yet.
		</p>
		<div class="row">
			<button type="button" onclick={keepMine}>Keep mine</button>
			<button type="button" onclick={useTheirs}>Use the other one</button>
		</div>
	</section>
{/if}
	{#if stage === 'run' && unticked}
		<div class="notice" data-tone={setsDone ? 'warn' : undefined}>
			<span class="notice-text">{!setsDone ? `No ${oneWord} is ticked yet, so Finish would save none.` : unticked === 1 ? `1 planned ${oneWord} isn’t ticked, so it won’t be saved.` : `${unticked} planned ${allWords} aren’t ticked, so they won’t be saved.`}</span>
			<span class="notice-acts"><button type="button" class="quiet" onclick={tickAll}>Tick {unticked === 1 ? 'it' : `all ${unticked}`}</button></span>
		</div>
	{/if}
	{#if stage === 'run' && suggested.length}
		<div class="notice" data-tone="warn">
			<span class="notice-text">{suggested.length > 4 ? `${suggested.slice(0, 4).join(', ')} and ${suggested.length - 4} more` : suggested.join(', ')} still {suggested.length === 1 ? 'shows' : 'show'} last time’s values or targets. Nothing is logged there, so it won’t be saved.</span>
			<span class="notice-acts"><button type="button" class="quiet" onclick={() => (suggestionsConfirmed = true)}>Keep {suggested.length === 1 ? 'it' : 'them'}</button></span>
		</div>
	{/if}
	{#if stage === 'run'}
	<form
		method="POST"
		action="?/save"
		class="lg-form"
		bind:this={finishForm}
		use:enhance={async ({ cancel }) => {
			problem = '';
			const gaps = missing();
			if (gaps.length) {
				problem = `Fill in ${gaps.join(', ')}.`;
				cancel();
				return;
			}
			endRest();
			dropAutosave();
			// Offline, or behind what still waits from offline (a swap): it waits too, so it comes after.
			if (!navigator.onLine || !(await sendAhead(saveUrl(), []))) {
				cancel();
				enqueue(saveUrl(), [['payload', payload(true, true)]], data.habitName);
				clearDraft();
				showToast(`Logged ${data.habitName}. It will sync when you're back online.`);
				goto(data.back);
				return;
			}
			return async ({ result, update }) => {
				if (result.type === 'error' && isOffline(result.error)) {
					enqueue(saveUrl(), [['payload', payload(true, true)]], data.habitName);
					clearDraft();
					showToast(`Logged ${data.habitName}. It will sync when you're back online.`);
					goto(data.back);
					return;
				}
				if (result.type === 'failure' && result.data?.stale) return changedElsewhere(result.data.stale, 'finish');
				if (result.type === 'redirect' || result.type === 'success') clearDraft();
				await update({ reset: false });
			};
		}}
	>
		<input type="hidden" name="payload" value={payload(true)} />
		<button class="lg-finish" class:primary={!setsLeft || quickMode} bind:this={finishButton}>{quickMode ? 'Save' : 'Finish'}</button>
	</form>
	{#if canRepeat && !quickMode}
		<button type="button" class="lg-wide" onclick={sameAsLast}>{started ? 'Fill the rest as last time and finish' : 'Same as last time'}</button>
	{/if}
	{/if}
</div>

<style>
	.elsewhere {
		/* In view wherever you type, without moving what you type in. */
		position: sticky;
		bottom: var(--tabbar-clear);
		z-index: var(--z-heading);
		border-color: var(--danger);
	}
	.elsewhere p {
		margin: 0 0 var(--space-inline);
	}
	p,
	h2 {
		margin: 0;
	}
	.lg-top {
		justify-content: space-between;
		align-items: start;
		margin-block-end: var(--space-group);
	}
	.lg-layout {
		display: inline-flex;
		align-items: center;
		gap: var(--space-tight);
		color: var(--ink-muted);
	}
	.lg-layout select {
		width: auto;
	}
	.lg-end {
		display: grid;
		gap: var(--space-group);
	}
	.lg-form {
		display: grid;
	}
	/* What logs or ends the log stays where it is, out of reach while editing. */
	.lg-editing :is(.lg-form, .lg-wide) {
		visibility: hidden;
	}
	.lg-heading {
		list-style: none;
	}
	.howto {
		flex-basis: 100%;
		margin-block-start: var(--space-inline);
	}
</style>
