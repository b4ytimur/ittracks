<script lang="ts">
	import { enhance } from '$app/forms';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, tick, untrack } from 'svelte';
	import Timer from './Timer.svelte';
	import Place from '$lib/log/Place.svelte';
	import { cursor, follow, rowText, type Cursor, type Field, type RowState } from '$lib/log/run';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import MenuButton, { type Way } from '$lib/ui/MenuButton.svelte';
	import NumberField from '$lib/ui/NumberField.svelte';
	import { endRest, startRest } from '$lib/rest.svelte';
	import { defaultStep } from '$lib/task-types';
	import { enqueue, isOffline, save } from '$lib/outbox.svelte';
	import { postAction, showToast, undoWith } from '$lib/toast.svelte';
	import { differs, revOf, type LogContent } from '$lib/logrev';
	import { fromDraft, placeKey } from '$lib/log/places';
	import NoteBox from '$lib/NoteBox.svelte';
	import Markdown from '$lib/Markdown.svelte';
	import { starterFor, untouched } from '$lib/journal';
	import { isSuggestion, keepsSuggestions, onlySuggested, type PlaceStart } from '$lib/prefill';

	let { data, form } = $props();

	type Values = Record<string, unknown>;
	/** One place in the log: a Slot's Task, or a Task inside it (see engine/parts.ts). */
	interface ItemState {
		sets: RowState[];
		summary: Values;
		/** The tick of a Yes or no Task, or of a step (no fields and nothing inside). */
		tick?: boolean;
	}
	type Item = (typeof data.items)[number];
	type Metric = NonNullable<Item['task']>['metrics'][number];

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
		const count = repeating.length ? (it.sets ?? (prev.length || 1)) : 0;
		const sets = Array.from({ length: count }, (_, i) => ({
			done: false,
			values: Object.fromEntries(
				repeating
					.map((m) => [m.id, prefillValue(m, it, (prev[i] ?? prev.at(-1))?.[m.id])] as const)
					.filter(([, v]) => v !== undefined)
			) as Values
		}));
		const summary = Object.fromEntries(
			single.map((m) => [m.id, prefillValue(m, it, prevSummary[m.id])] as const).filter(([, v]) => v !== undefined)
		) as Values;
		// A Yes or no Task or a step starts unticked like any tick box: you tick the ones you did.
		return { sets, summary: withStarters(summary, t), tick: false };
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
	}
	const readDraft = (): Draft | null => {
		try {
			return JSON.parse(localStorage.getItem(DRAFT) ?? 'null');
		} catch {
			return null;
		}
	};

	/** What is being logged, by place. A place that goes keeps its values here, in case it comes back. */
	const places = $state<Record<string, ItemState>>(untrack(() => Object.fromEntries(data.items.map((it) => [placeKey(it), initial(it)]))));
	/** The prefill, to show which values differ from it. */
	const startOf = (it: Item): ItemState => (data.occurrence.status === 'done' ? initial(it) : { ...initial(it), sets: planned(it).sets });
	let base = $state.raw<Record<string, ItemState>>(untrack(() => Object.fromEntries(data.items.map((it) => [placeKey(it), startOf(it)]))));
	// A place that comes into the log (a swap, a reroll, a part added) starts as the log does.
	$effect.pre(() => {
		const fresh = data.items.filter((it) => untrack(() => !places[placeKey(it)]));
		untrack(() => {
			for (const it of fresh) {
				const s = initial(it);
				base = { ...base, [placeKey(it)]: startOf(it) };
				places[placeKey(it)] = s;
			}
		});
	});
	/** The same, in the order the log shows them. */
	const log = $derived(data.items.map((it) => places[placeKey(it)] ?? initial(it)));
	const baseOf = (i: number): ItemState | undefined => base[placeKey(data.items[i])];
	let notes = $state(untrack(() => data.occurrence.notes));
	let level = $state<'minimum' | 'target' | 'stretch'>(untrack(() => data.occurrence.level));
	let problem = $state('');
	const levelNames = { minimum: 'Minimum', target: 'Target', stretch: 'Stretch' } as const;
	/** The target for a Metric at the chosen level, falling back to Target. */
	const targetAt = (it: (typeof data.items)[number], id: string) =>
		(level === 'minimum' ? it.minTargets[id] : level === 'stretch' ? it.stretchTargets[id] : undefined) ??
		it.targets[id];
	// ----- Autosave: every change is kept on this device at once, and on the server shortly after -----
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
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
			Object.assign(places, fromDraft(d.log, data.items));
			notes = d.notes;
			level = d.level;
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
		try {
			localStorage.setItem(DRAFT, JSON.stringify({ log: $state.snapshot(places), notes, level, synced, bases }));
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
		const a = await save(saveUrl(), [['payload', body]], data.habitName);
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
	const taskName = (id: string) => data.items.find((it) => it.task?.id === id)?.task?.name ?? 'another Task';
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
			Object.assign(places, fromDraft(mine.log, data.items));
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

	/** What each place started with: its suggested values (last time's, or targets) and what was saved. */
	const starts = $derived<PlaceStart[]>(
		data.items.map((it) => ({ prefill: planned(it).summary, saved: it.saved.find(isSummary) ?? {}, savedAny: it.saved.length > 0 }))
	);
	/** Finish was answered "Yes" for places that still show only suggested values: they are kept. */
	let suggestionsConfirmed = $state(false);

	/**
	 * What gets saved. Only ticked sets: a planned set nobody ticked was not done (Finish asks
	 * first, see untickedSets). Every set counts as done on a quick log, since only some
	 * fields are shown there. A suggested value (last time's, or the target) nobody touched is
	 * not saved as you go, and on Finish only as src/lib/prefill.ts says.
	 */
	function payload(finish: boolean, stay = false) {
		// Each value says where it sits, so the same Task in two places keeps its own.
		const entries: { taskId: string; path: string | null; values: Values }[] = [];
		data.items.forEach((it, i) => {
			const path = it.path;
			const t = it.task;
			if (!t) return;
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
			const keep = (quickMode && finish) || keepsSuggestions(log, starts, i, { finish, confirmed: suggestionsConfirmed });
			const filled = Object.entries(s.summary).filter(
				([k, v]) =>
					v !== '' &&
					v !== null &&
					v !== undefined &&
					!(longs.has(k) && untouched(longs.get(k)!, v, data.occurrence.date)) &&
					(keep || !isSuggestion(s, starts[i], k))
			);
			if (filled.length) entries.push({ taskId: t.id, path, values: { ...Object.fromEntries(filled), _summary: true } });
			if (s.tick && isYesNo(it)) entries.push({ taskId: t.id, path, values: { done: true } });
		});
		// Values for places this log no longer shows go back as they were.
		entries.push(...data.orphans.map((e) => ({ taskId: e.taskId, path: e.path ?? null, values: e.values })));
		return JSON.stringify({ finish, stay, notes, entries, level, back: data.back, bases });
	}

	const empty = (v: unknown) => v === undefined || v === null || v === '' || v === false;

	/** Planned sets with values in them that nobody ticked, which Finish would leave out. */
	function untickedSets(): number {
		if (quickMode || !isOpen) return 0;
		let n = 0;
		data.items.forEach((it, i) => {
			const ids = it.task?.metrics.filter((m) => m.repeats).map((m) => m.id) ?? [];
			n += log[i]?.sets.filter((set) => !set.done && ids.some((id) => !empty(set.values[id]))).length ?? 0;
		});
		return n;
	}
	/** Places that still show only suggested values while others have a log (a session left half way), by name. */
	function suggestedPlaces(): string[] {
		if (quickMode || !isOpen) return [];
		return onlySuggested(log, starts).map((i) => {
			const it = data.items[i];
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
		data.items.forEach((it, i) => {
			const t = it.task;
			if (!t) return;
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
	const runPlaces = $derived(data.items.flatMap((it, i) => (inRows(it) ? [{ key: placeKey(it), sets: log[i].sets }] : [])));
	const row = $derived(stage === 'run' ? cursor(runPlaces, at, here) : at);
	const setsLeft = $derived(runPlaces.some((p) => p.sets.some((x) => !x.done)));
	const setsDone = $derived(runPlaces.reduce((n, p) => n + p.sets.filter((x) => x.done).length, 0));
	const setsAll = $derived(runPlaces.reduce((n, p) => n + p.sets.length, 0));

	function show(key: string) {
		tick().then(() => document.querySelector(`[data-place="${CSS.escape(key)}"] .lg-open`)?.scrollIntoView({ block: 'nearest' }));
	}
	function openRow(i: number, set: number | null) {
		const key = placeKey(data.items[i]);
		here = key;
		at = set === null ? null : { key, set };
		if (set !== null) show(key);
	}
	function unfold(i: number) {
		const left = log[i].sets.some((x) => !x.done) && stage === 'run';
		openRow(i, left ? null : log[i].sets.length - 1);
		show(placeKey(data.items[i]));
	}
	const metricsOf = (it: Item) => repeatingOf(it) as Field[];

	function doneRow(i: number, set: number, keyboard: boolean) {
		const it = data.items[i];
		const key = placeKey(it);
		log[i].sets[set].done = true;
		places[key].sets = follow(log[i].sets, baseOf(i)?.sets ?? [], set, metricsOf(it));
		logged = { key, set };
		setTimeout(() => {
			if (logged?.key === key && logged.set === set) logged = null;
		}, LOGGED_MS);
		at = null;
		here = key;
		const next = cursor(runPlaces, null, key);
		// The last one stays open, so nothing that ends the log ever comes under the thumb.
		if (!next) at = { key, set };
		const to = next ? data.items.find((x) => placeKey(x) === next.key) : undefined;
		const nextName = to ? `${next!.key === key ? '' : `${to.task?.name}, `}set ${next!.set + 1}` : '';
		if (it.task?.restTimerEnabled && next && !data.past && stage === 'run') startRest(it.task.restTimerSeconds, `set ${next.set + 1} of ${to?.task?.name}`, `/log/${data.occurrence.id}`);
		else endRest();
		said = `Logged set ${set + 1}.${next ? ` Next: ${nextName}, ${rowText(metricsOf(to!), places[next.key].sets[next.set].values)}.` : ' All sets are done.'}`;
		if (next && next.key !== key) {
			here = next.key;
			show(next.key);
			if (keyboard) tick().then(() => document.querySelector<HTMLElement>(`[data-place="${CSS.escape(next.key)}"] .lg-act`)?.focus());
		}
	}
	function tickRow(i: number, set: number, on: boolean) {
		const key = placeKey(data.items[i]);
		log[i].sets[set].done = on;
		if (on) {
			places[key].sets = follow(log[i].sets, baseOf(i)?.sets ?? [], set, metricsOf(data.items[i]));
			const t = data.items[i].task;
			if (t?.restTimerEnabled && stage === 'run' && !data.past) startRest(t.restTimerSeconds, t.name, `/log/${data.occurrence.id}`);
		} else {
			endRest();
			here = key;
			at = { key, set };
		}
		said = `Set ${set + 1} ${on ? 'done' : 'not done'}.`;
	}
	/** Changing a number never logs it. */
	function setValue(i: number, set: number, id: string, v: unknown) {
		const x = log[i].sets[set];
		x.values[id] = v;
		if (!x.own?.includes(id)) x.own = [...(x.own ?? []), id];
		// Stepping the row keeps it open, also once it is the only one left.
		if (stage === 'run') at = { key: placeKey(data.items[i]), set };
		if (x.done) places[placeKey(data.items[i])].sets = follow(log[i].sets, baseOf(i)?.sets ?? [], set, metricsOf(data.items[i]));
	}
	function addSet(i: number) {
		const last = log[i].sets.at(-1);
		log[i].sets.push({ done: false, values: { ...(last?.values ?? {}) } });
	}
	function removeSet(i: number) {
		const gone = log[i].sets.pop();
		at = null;
		if (gone) showToast(`Removed set ${log[i].sets.length + 1} of ${data.items[i].task?.name}, for this log.`, () => void log[i]?.sets.push(gone));
	}
	function tickAll() {
		for (const [i, it] of data.items.entries()) {
			const ids = it.task?.metrics.filter((m) => m.repeats).map((m) => m.id) ?? [];
			for (const x of log[i].sets) if (ids.some((id) => !empty(x.values[id]))) x.done = true;
		}
		at = null;
		endRest();
	}

	// How the places stand: one open and the others a line each, or all open. Kept per habit on this device.
	const LAYOUT = untrack(() => `log-layout:${data.habitId}`);
	let layout = $state<'current' | 'all'>('current');
	onMount(() => {
		try {
			if (localStorage.getItem(LAYOUT) === 'all') layout = 'all';
		} catch {
			/* storage blocked */
		}
	});
	function setLayout(v: string) {
		layout = v === 'all' ? 'all' : 'current';
		try {
			localStorage.setItem(LAYOUT, layout);
		} catch {
			/* storage blocked */
		}
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
	const isPrefill = (i: number, id: string) =>
		isOpen && starts[i]?.prefill[id] != null && (log[i].summary[id] ?? null) === starts[i].prefill[id];

	/** Something is logged already: Same as last fills in only the rest. */
	const started = $derived(data.items.some((it, i) => it.saved.length || log[i]?.sets.some((x) => x.done) || log[i]?.tick));

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
		goto(`/?did=${data.occurrence.id}${started ? '' : '&clear=1'}`);
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

	const canRepeat = $derived(isOpen && data.items.some((it) => it.previous.length));

	const dateLabel = $derived(
		new Date(data.occurrence.date + 'T12:00:00').toLocaleDateString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		})
	);

	const LIST = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
	const recapOf = (id: string, best = false) => {
		const rc = data.recap[id];
		return rc ? `Last time ${LIST.format(new Date(rc.date + 'T12:00:00'))} · ${rc.text}${best && rc.best ? ` · best ${rc.best}` : ''}` : stage === 'run' ? 'First time' : '';
	};
	const headOf = (it: Item, i: number) => {
		const t = it.task!;
		const n = log[i].sets.length;
		const targets = repeatingOf(it).flatMap((m) => {
			const v = targetAt(it, m.id);
			return v === undefined ? [] : [`${v} ${m.unit ?? m.name.toLowerCase()}`];
		});
		const rest = t.restTimerEnabled ? `rest ${t.restTimerSeconds % 60 ? `${t.restTimerSeconds} s` : `${t.restTimerSeconds / 60} min`}` : '';
		return [`${n} ${n === 1 ? 'set' : 'sets'}`, ...targets, rest].filter(Boolean).join(' · ');
	};
	const foldedAt = (i: number) => {
		const it = data.items[i];
		if (quickMode || layout === 'all' || !inRows(it)) return false;
		return row ? row.key !== placeKey(it) : stage === 'correct' || runPlaces.length > 1;
	};
	let swapping = $state<string | null>(null);
	let howTo = $state<string | null>(null);
	let finishButton = $state<HTMLButtonElement>();
	function goToFinish() {
		finishButton?.scrollIntoView({ block: 'center' });
		finishButton?.focus({ preventScroll: true });
	}
	function menuOf(it: Item): (Way | '-')[] {
		const key = placeKey(it);
		return [
			...(it.task?.notes.trim() ? [{ label: howTo === key ? 'Hide how to' : 'How to', onselect: () => (howTo = howTo === key ? null : key) }] : []),
			...(it.task ? [{ label: 'Last 7 times', href: `/library/${it.task.id}` }] : []),
			...(stage === 'run' && it.depth === 0 ? [{ label: 'Swap…', onselect: () => (swapping = key) }] : []),
			...(stage === 'run' && it.open ? [{ label: 'Pick another', action: '?/reroll', fields: { slot: it.slotId } }] : [])
		];
	}
	const hint = $derived(
		[
			data.variantName,
			data.past && isOpen ? `for ${dateLabel}` : dateLabel,
			data.occurrence.status !== 'due' ? data.occurrence.status : null,
			setsAll ? `${setsDone} of ${setsAll} sets done` : null,
			data.past && isOpen
				? 'Kept on this device, not counted until you finish'
				: { idle: correcting ? 'Saves as you change it' : null, saving: 'Saving…', saved: 'Saved', local: 'Saved on this device', refused: 'Not saved' }[saveState]
		]
			.filter(Boolean)
			.join(' · ')
	);

	const prevSummary = (i: number) => data.items[i].previous.find(isSummary) ?? {};
	const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v));
	const stepOf = (m: Metric) => m.step ?? defaultStep(m.type, m.unit);
	const isNumeric = (m: Metric) => m.type === 'number' || m.type === 'count' || m.type === 'duration';
	/** Required fields always show, so a quick log can always be finished. */
	const shownMetrics = (ms: Metric[]) => (quickMode ? ms.filter((m) => m.quick || m.required) : ms);
</script>

<svelte:head><title>{data.habitName} · ittracks</title></svelte:head>
<svelte:window onkeydown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && stage === 'run' && finishForm?.requestSubmit()} />

<EditChrome title={quickMode ? `Quick log: ${data.habitName}` : data.habitName} back={{ href: data.back, label: 'Back' }} modes={['use']} hints={{ use: hint }} />
{#if saveState === 'refused' && !theirs}<p class="error" role="alert">Not saved: {refusedWhy}</p>{/if}
<p class="vh" role="status">{said}</p>

{#if stage === 'read'}
	<div class="notice"><span class="notice-text">This day is further back than Settings allow logging, so it can only be looked at.</span><span class="notice-acts"><a class="quiet hit" href="/settings/past-days">Change it in Settings</a></span></div>
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
				<label class="check"><input type="checkbox" class="tick" disabled={stage === 'read'} checked={!!log[i].summary[m.id]} onchange={(e) => (log[i].summary[m.id] = e.currentTarget.checked)} /> {m.name}{m.required ? ', required' : ''}</label>
			{:else if m.type === 'choice' && (m.choices?.length ?? 0) <= 7}
				<span class="label">{m.name}{m.required ? ', required' : ''}</span>
				<div class="chips" role="group" aria-label={m.name}>
					{#each m.choices ?? [] as c (c.id)}
						<button type="button" class="toggle" disabled={stage === 'read'} aria-pressed={log[i].summary[m.id] === c.id} onclick={() => (log[i].summary[m.id] = log[i].summary[m.id] === c.id ? null : c.id)}>{c.name}</button>
					{/each}
				</div>
			{:else if m.type === 'choice'}
				<label class="label" for="f-{i}-{m.id}">{m.name}{m.required ? ', required' : ''}</label>
				<select id="f-{i}-{m.id}" disabled={stage === 'read'} value={num(log[i].summary[m.id])} onchange={(e) => (log[i].summary[m.id] = e.currentTarget.value)}>
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
					bind:value={() => num(log[i].summary[m.id]), (v) => (log[i].summary[m.id] = v)}
				/>
			{:else if m.type === 'text'}
				<label class="label" for="f-{i}-{m.id}">{m.name}{m.required ? ', required' : ''}</label>
				<input id="f-{i}-{m.id}" disabled={stage === 'read'} value={num(log[i].summary[m.id])} oninput={(e) => (log[i].summary[m.id] = e.currentTarget.value)} />
			{:else if isNumeric(m)}
				<span class="label">{m.name}{unit ? ` (${unit})` : ''}{m.required ? ', required' : ''}</span>
				<NumberField
					value={log[i].summary[m.id] as number | null}
					step={stepOf(m)}
					{unit}
					label="{m.name} for {it.task?.name}"
					disabled={stage === 'read'}
					caption={[targetAt(it, m.id) !== undefined ? `${data.levels ? levelNames[level] : 'Target'} ${targetAt(it, m.id)}` : '', prev !== undefined && isOpen ? `last time ${prev}` : ''].filter(Boolean).join(' · ')}
					onchange={(v) => (log[i].summary[m.id] = v)}
				/>
				{#if m.type === 'duration' && !quickMode && !data.past && stage === 'run'}
					<Timer
						bind:value={() => log[i].summary[m.id] as number | null, (v) => (log[i].summary[m.id] = v)}
						replace={isPrefill(i, m.id)}
						target={targetAt(it, m.id) ?? null}
						storageKey="timer:{data.occurrence.id}:{m.id}"
					/>
				{/if}
			{/if}
		</div>
	{/each}
{/snippet}

{#snippet extraOf(it: Item)}
	{@const t = it.task}
	{#if swapping === placeKey(it)}
		<form method="POST" action="?/swap" class="row lg-swap" use:enhance={() => async ({ update }) => { swapping = null; await update(); }}>
			<input type="hidden" name="slot" value={it.slotId} />
			<select class="grow" name="task" aria-label="Task to use instead of {t?.name ?? 'none'}">
				{#each data.library as l (l.id)}<option value={l.id} selected={l.id === t?.id}>{l.name}</option>{/each}
			</select>
			<button class="small">Use</button>
			<button type="button" class="small" onclick={() => (swapping = null)}>Cancel</button>
		</form>
	{/if}
	{#if t && howTo === placeKey(it)}<div class="howto"><Markdown text={t.notes} small /></div>{/if}
{/snippet}

<ul class="elist lg-page lg-places" data-mode="use" aria-label="What to log">
	{#each data.items as it, i (placeKey(it))}
		{@const t = it.task}
		{@const key = placeKey(it)}
		{@const single = t ? shownMetrics(t.metrics.filter((m) => !m.repeats)) : []}
		{#if it.roundHead && !quickMode}<li class="lg-heading"><h2 class="card-title">{it.roundHead}</h2></li>{/if}
		{#if t && isYesNo(it)}
			{#if !quickMode}
				<li class="row lg-row" class:done={log[i].tick} style:margin-inline-start="calc({it.depth} * var(--space-indent))">
					<div class="card">
						<span class="slot"></span>
						<div class="content"><label class="lg-tick-label" for="tick-{i}">{t.name}</label>{@render extraOf(it)}</div>
						<div class="verb">
							<input id="tick-{i}" type="checkbox" class="tick hit" disabled={stage === 'read'} bind:checked={log[i].tick} aria-label="{t.name} done" />
							{#if menuOf(it).length && stage === 'run'}<MenuButton class="lg-more hit" label="More for {t.name}" items={menuOf(it)} />{/if}
						</div>
					</div>
				</li>
			{/if}
		{:else if !t || !quickMode || shownMetrics(t.metrics).length}
			<li class="holder lg-place" class:lg-folded={foldedAt(i)} class:lg-folds={foldedAt(i)} class:done={inRows(it) && log[i].sets.length > 0 && log[i].sets.every((x) => x.done)} data-place={key} style:margin-inline-start="calc({it.depth} * var(--space-indent))">
				{#if t && inRows(it) && !quickMode}
					<Place
						name={t.name}
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
							{#if !t}<p class="meta-line">Nothing in your <a href="/library">Library</a> matches this place's rules.</p>{:else if recapOf(t.id)}<p class="meta-line">{recapOf(t.id, true)}</p>{/if}
							{@render extraOf(it)}
						</div>
						{#if menuOf(it).length && stage === 'run' && !quickMode}<div class="verb"><MenuButton class="lg-more hit" label="More for {t?.name ?? 'this place'}" items={menuOf(it)} /></div>{/if}
					</div>
					{#if t}
						<div class="shelf lg-shelf">
							{#if quickMode && inRows(it)}
								{#each log[i].sets as x, k (k)}
									<div class="lg-once">
										<span class="label">Set {k + 1}</span>
										<div class="lg-fields">
											{#each repeatingOf(it) as m (m.id)}
												{#if isNumeric(m)}
													<div class="field">
														<span class="label">{m.name}{m.unit ? ` (${m.unit})` : ''}</span>
														<NumberField value={x.values[m.id] as number | null} step={stepOf(m)} unit={m.unit ?? ''} label="{m.name} for {t.name}, set {k + 1}" onchange={(v) => (x.values[m.id] = v)} />
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
	{/each}
</ul>

<div class="lg-end">
	{#if data.items.length === 0}<p class="empty-first">Nothing to log here. Add Tasks to it in the habit's editor, or finish it as it is.</p>{/if}
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
			<button type="button" class="primary" onclick={keepMine}>Keep mine</button>
			<button type="button" onclick={useTheirs}>Use the other one</button>
		</div>
	</section>
{/if}
	{#if stage === 'run' && unticked}
		<div class="notice" data-tone={setsDone ? 'warn' : undefined}>
			<span class="notice-text">{!setsDone ? 'No set is ticked yet, so Finish would save none.' : unticked === 1 ? '1 planned set isn’t ticked, so it won’t be saved.' : `${unticked} planned sets aren’t ticked, so they won’t be saved.`}</span>
			<span class="notice-acts"><button type="button" class="quiet hit" onclick={tickAll}>Tick {unticked === 1 ? 'it' : `all ${unticked}`}</button></span>
		</div>
	{/if}
	{#if stage === 'run' && suggested.length}
		<div class="notice" data-tone="warn">
			<span class="notice-text">{suggested.length > 4 ? `${suggested.slice(0, 4).join(', ')} and ${suggested.length - 4} more` : suggested.join(', ')} still {suggested.length === 1 ? 'shows' : 'show'} last time’s values or targets. Nothing is logged there, so it won’t be saved.</span>
			<span class="notice-acts"><button type="button" class="quiet hit" onclick={() => (suggestionsConfirmed = true)}>Keep {suggested.length === 1 ? 'it' : 'them'}</button></span>
		</div>
	{/if}
	{#if stage === 'run'}
	<form
		method="POST"
		action="?/save"
		class="lg-form"
		bind:this={finishForm}
		use:enhance={({ cancel }) => {
			problem = '';
			const gaps = missing();
			if (gaps.length) {
				problem = `Fill in ${gaps.join(', ')}.`;
				cancel();
				return;
			}
			endRest();
			dropAutosave();
			if (!navigator.onLine) {
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
		z-index: 4;
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
	.lg-heading {
		list-style: none;
	}
	.howto,
	.lg-swap {
		flex-basis: 100%;
		margin-block-start: var(--space-inline);
	}
</style>
