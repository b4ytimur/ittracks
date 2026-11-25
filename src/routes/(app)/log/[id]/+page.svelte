<script lang="ts">
	import { enhance } from '$app/forms';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, tick, untrack } from 'svelte';
	import Timer from './Timer.svelte';
	import Stepper from './Stepper.svelte';
	import { defaultStep } from '$lib/task-types';
	import { enqueue, isOffline, save } from '$lib/outbox.svelte';
	import { postAction, showToast } from '$lib/toast.svelte';
	import { differs, revOf, type LogContent } from '$lib/logrev';
	import NoteBox from '$lib/NoteBox.svelte';
	import Markdown from '$lib/Markdown.svelte';
	import { starterFor, untouched } from '$lib/journal';
	import { isSuggestion, keepsSuggestions, onlySuggested, type PlaceStart } from '$lib/prefill';

	let { data, form } = $props();

	type Values = Record<string, unknown>;
	/** One place in the log: a Slot's Task, or a Task inside it (see engine/parts.ts). */
	interface ItemState {
		sets: { done: boolean; values: Values }[];
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
	 * Build the editable state for each place. A finished log shows what was saved. A log
	 * that is still due shows the saved (ticked) sets first, then the planned sets not
	 * logged yet, so leaving half way through a workout loses nothing.
	 */
	function initial(): ItemState[] {
		return data.items.map((it) => {
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
		});
	}

	const DRAFT = untrack(() => `log-draft:${data.occurrence.id}`);
	interface Draft {
		log: ItemState[];
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

	let log = $state<ItemState[]>(untrack(initial));
	/** The prefill, to show which values differ from it. */
	let base = $state.raw<ItemState[]>(untrack(() => structuredClone($state.snapshot(log))));
	let notes = $state(untrack(() => data.occurrence.notes));
	let level = $state<'minimum' | 'target' | 'stretch'>(untrack(() => data.occurrence.level));
	let problem = $state('');
	const levelNames = { minimum: 'Minimum', target: 'Target', stretch: 'Stretch' } as const;
	/** The target for a Metric at the chosen level, falling back to Target. */
	const targetAt = (it: (typeof data.items)[number], id: string) =>
		(level === 'minimum' ? it.minTargets[id] : level === 'stretch' ? it.stretchTargets[id] : undefined) ??
		it.targets[id];
	let restEnd = $state<number | null>(null);
	let now = $state(Date.now());

	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(t);
	});
	const restLeft = $derived(restEnd ? Math.max(0, Math.ceil((restEnd - now) / 1000)) : null);
	$effect(() => {
		if (restLeft === 0) navigator.vibrate?.(300);
	});

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
		if (d && !d.synced && data.occurrence.status !== 'done' && d.log.length === log.length) {
			log = d.log;
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
			if (!isOpen) return;
			writeDraft(false);
			// A past day is saved on Finish only, so leaving it half done doesn't leave a partial log.
			if (data.past) return;
			clearTimeout(saveTimer);
			saveTimer = setTimeout(autosave, 1500);
		});
	});

	function writeDraft(synced: boolean) {
		try {
			localStorage.setItem(DRAFT, JSON.stringify({ log: $state.snapshot(log), notes, level, synced, bases }));
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
		const body = payload(false, true);
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
		if (a.kind === 'saved') writeDraft(true);
		refusedWhy = a.kind === 'refused' ? a.why : '';
		saveState = a.kind === 'later' ? 'local' : a.kind;
		return a;
	}

	/** What is being sent may be on the server before its answer is here: later saves may grow from it. */
	function sending(body: string): string {
		const rev = revOf(JSON.parse(body) as LogContent);
		bases = [...bases.filter((b) => b !== rev), rev].slice(-20);
		writeDraft(false);
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
			untickedAnswered = true;
			await tick(); // the form holds the payload
			finishForm?.requestSubmit();
		} else await autosave();
	}
	/** Show what the other device left. This one is kept aside, so it can be had back. */
	const ASIDE = untrack(() => `log-aside:${data.occurrence.id}`);
	function useTheirs() {
		try {
			localStorage.setItem(ASIDE, JSON.stringify({ log: $state.snapshot(log), notes, level }));
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
		if (!d || d.log.length !== log.length) return;
		const mine = d;
		showToast('Showing what the other device saved.', () => {
			log = mine.log;
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
	/** Finish was pressed with unticked sets or places with only suggested values: ask whether they were done. */
	let askUnticked = $state(0);
	let askSuggested = $state<string[]>([]);
	const asking = $derived(askUnticked > 0 || askSuggested.length > 0);
	const askText = $derived.by(() => {
		const sets = askUnticked === 1 ? '1 planned set isn’t ticked' : `${askUnticked} planned sets aren’t ticked`;
		const names = askSuggested.length > 4 ? `${askSuggested.slice(0, 4).join(', ')} and ${askSuggested.length - 4} more` : askSuggested.join(', ');
		const places = `${names} still ${askSuggested.length === 1 ? 'shows' : 'show'} last time’s values or targets, with nothing logged`;
		const one = askUnticked + askSuggested.length === 1;
		const parts = [askUnticked ? sets : '', askSuggested.length ? places : ''].filter(Boolean);
		return `${parts.join(', and ')}. Did you do ${one ? 'it' : 'them'}?`;
	});
	let finishForm = $state<HTMLFormElement>();
	let untickedAnswered = false;
	async function finishWith(tickAll: boolean) {
		if (tickAll)
			data.items.forEach((it, i) => {
				const ids = it.task?.metrics.filter((m) => m.repeats).map((m) => m.id) ?? [];
				for (const set of log[i].sets) if (ids.some((id) => !empty(set.values[id]))) set.done = true;
			});
		suggestionsConfirmed = tickAll;
		untickedAnswered = true;
		askUnticked = 0;
		askSuggested = [];
		await tick();
		finishForm?.requestSubmit();
	}
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

	function setDone(i: number, j: number, done: boolean) {
		log[i].sets[j].done = done;
		const t = data.items[i].task;
		if (done && t?.restTimerEnabled) restEnd = Date.now() + t.restTimerSeconds * 1000;
	}

	/** Changing a set's value marks it done: you did that set. */
	function setValue(i: number, j: number, metricId: string, v: unknown) {
		const set = log[i].sets[j];
		set.values[metricId] = v;
		if (!set.done) set.done = true;
	}

	function finishRemaining(i: number) {
		for (const s of log[i].sets) s.done = true;
	}

	function addSet(i: number) {
		const last = log[i].sets.at(-1);
		log[i].sets.push({ done: false, values: { ...(last?.values ?? {}) } });
	}

	function resetItem(i: number) {
		log[i] = initial()[i];
		const b = [...base];
		b[i] = structuredClone($state.snapshot(log[i]));
		base = b;
	}

	const changedSet = (i: number, j: number, id: string) =>
		isOpen && base[i]?.sets[j] !== undefined && (base[i].sets[j].values[id] ?? null) !== (log[i].sets[j].values[id] ?? null);
	const changedSummary = (i: number, id: string) =>
		isOpen && (base[i]?.summary[id] ?? null) !== (log[i].summary[id] ?? null);
	/**
	 * The value is still the prefill (last time or the target), not something logged now. It is
	 * compared with the prefill itself, so an autosave and a reload don't turn it into time logged.
	 */
	const prefills = untrack(() => data.items.map((it) => planned(it).summary));
	const isPrefill = (i: number, id: string) =>
		isOpen && prefills[i]?.[id] != null && (log[i].summary[id] ?? null) === prefills[i][id];

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

	const prevSummary = (i: number) => data.items[i].previous.find(isSummary) ?? {};
	const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v));
	const stepOf = (m: Metric) => m.step ?? defaultStep(m.type, m.unit);
	const isNumeric = (m: Metric) => m.type === 'number' || m.type === 'count' || m.type === 'duration';
	/** Required fields always show, so a quick log can always be finished. */
	const shownMetrics = (ms: Metric[]) => (quickMode ? ms.filter((m) => m.quick || m.required) : ms);
</script>

<svelte:head><title>{data.habitName} · ittracks</title></svelte:head>

<header class="bar">
	<div>
		<h1>{quickMode ? `Quick log: ${data.habitName}` : data.habitName}</h1>
		<div class="muted">
			{[data.variantName, dateLabel, data.occurrence.status !== 'due' ? data.occurrence.status : null]
				.filter(Boolean)
				.join(' · ')}
			{#if saveState === 'saving'}· saving…{:else if saveState === 'saved'}· saved{:else if saveState === 'local'}· saved on this device{:else if saveState === 'refused'}· <span class="error">not saved: {refusedWhy}</span>{/if}
		</div>
	</div>
	<a href={data.back}>Back</a>
</header>

{#if !data.canLog && data.occurrence.status !== 'done'}
	<p class="card muted small-text">This day is further back than Settings allow logging, so it can only be looked at. <a href="/settings/past-days">Change it in Settings</a>.</p>
{:else if data.past && isOpen}
	<p class="muted small-text past">Logging a past day. It counts like a log on the day.</p>
{/if}

{#if canRepeat && !quickMode}
	<div class="row repeat">
		<button type="button" class:primary={!started} class="grow" onclick={sameAsLast}>{started ? 'Fill the rest as last time' : 'Same as last time'}</button>
		<span class="muted small-text"
			>{started
				? 'Keeps what you logged here, copies the rest from your last log, and finishes.'
				: data.past
					? 'Copies your last log from before this day and finishes.'
					: 'Copies your last log and finishes.'}</span
		>
	</div>
{/if}

{#if data.levels}
	<fieldset class="card levels" aria-label="Level">
		<div class="chips">
			{#each ['minimum', 'target', 'stretch'] as const as l (l)}
				<button type="button" class="chip" class:on={level === l} onclick={() => (level = l)}>{levelNames[l]}</button>
			{/each}
		</div>
		{#if data.levels[level]}<p class="muted small-text" style="margin: 0.4rem 0 0">{data.levels[level]}</p>{/if}
	</fieldset>
{/if}

{#each data.items as it, i (it.path)}
	{@const t = it.task}
	{#if it.roundHead && !quickMode}
		<h3 class="round" style:margin-left="{it.depth - 1}rem">{it.roundHead}</h3>
	{/if}
	{#if t && isYesNo(it) && it.depth > 0}
		<!-- A step inside a Task: one tick box under it. -->
		{#if !quickMode}
			<label class="step" style:margin-left="{it.depth}rem"><input type="checkbox" class="tick" bind:checked={log[i].tick} /> {t.name}</label>
		{/if}
	{:else if !quickMode || (t && shownMetrics(t.metrics).length)}
	<section class="card stack" class:nested={it.depth > 0} style:margin-left="{it.depth}rem">
		<div class="row">
			{#if it.depth > 0}
				<h3 class="grow" style="margin: 0">{t?.name ?? 'No matching Task'}</h3>
			{:else}
				<h2 class="grow" style="margin: 0">{t?.name ?? 'No matching Task'}</h2>
			{/if}
			{#if it.open && !quickMode}
				<form method="POST" action="?/reroll" use:enhance={() => async ({ update }) => { await update(); resetItem(i); }}>
					<input type="hidden" name="slot" value={it.slotId} />
					<button class="small" title="Pick another Task">Reroll</button>
				</form>
			{/if}
			{#if !quickMode && it.depth === 0}
				<details class="swap">
					<summary class="small-text">Swap</summary>
					<form method="POST" action="?/swap" class="row" use:enhance={() => async ({ update }) => { await update(); resetItem(i); }}>
						<input type="hidden" name="slot" value={it.slotId} />
						<select name="task" aria-label="Task to use">
							{#each data.library as l (l.id)}<option value={l.id} selected={l.id === t?.id}>{l.name}</option>{/each}
						</select>
						<button class="small">Use</button>
					</form>
				</details>
			{/if}
		</div>
		{#if it.open && !t}
			<p class="muted">No Task in your Library matches this slot's rules. <a href="/library">Open the Library</a>.</p>
		{/if}
		{#if t && data.recap[t.id]}
			{@const rc = data.recap[t.id]}
			<p class="muted small-text recap">
				Last time ({new Date(rc.date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}): {rc.text}{rc.best ? ` · best ${rc.best}` : ''}{' · '}<a href="/library/{t.id}">History</a>
			</p>
		{/if}
		{#if t?.notes.trim() && !quickMode}
			<details class="howto">
				<summary class="small-text">How to</summary>
				<div class="howto-body"><Markdown text={t.notes} small /></div>
			</details>
		{/if}

		{#if t}
			{@const repeating = shownMetrics(t.metrics.filter((m) => m.repeats))}
			{@const single = shownMetrics(t.metrics.filter((m) => !m.repeats))}

			{#if repeating.length}
				<table class="sets">
					<thead>
						<tr>
							<th>Set</th>
							{#each repeating as m (m.id)}<th>{m.name}{m.unit ? ` (${m.unit})` : ''}{m.required ? ' *' : ''}</th>{/each}
							{#if !quickMode}<th>Done</th>{/if}
						</tr>
					</thead>
					<tbody>
						{#each log[i].sets as set, j (j)}
							<tr class:done={set.done}>
								<td>{j + 1}</td>
								{#each repeating as m (m.id)}
									<td>
										{#if m.type === 'checkbox'}
											<input type="checkbox" checked={!!set.values[m.id]} onchange={(e) => setValue(i, j, m.id, e.currentTarget.checked)} />
										{:else if m.type === 'choice'}
											<select value={num(set.values[m.id])} onchange={(e) => setValue(i, j, m.id, e.currentTarget.value)}>
												<option value=""></option>
												{#each m.choices ?? [] as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
											</select>
										{:else if m.type === 'text'}
											<input value={num(set.values[m.id])} oninput={(e) => setValue(i, j, m.id, e.currentTarget.value)} />
										{:else}
											<Stepper compact value={set.values[m.id] as number | null} step={stepOf(m)} label="{m.name}, set {j + 1}"
												changed={changedSet(i, j, m.id)} onchange={(v) => setValue(i, j, m.id, v)} />
										{/if}
									</td>
								{/each}
								{#if !quickMode}
									<td><input type="checkbox" class="tick" checked={set.done} onchange={(e) => setDone(i, j, e.currentTarget.checked)} aria-label="Set {j + 1} done" /></td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
				<div class="row">
					<button type="button" class="small" onclick={() => addSet(i)}>+ set</button>
					{#if log[i].sets.length}
						<button type="button" class="small" onclick={() => log[i].sets.pop()}>− set</button>
					{/if}
					{#if !quickMode && log[i].sets.some((x) => !x.done)}
						<button type="button" class="small" onclick={() => finishRemaining(i)}>Finish remaining sets as planned</button>
					{/if}
					{#if it.sets}<span class="muted small-text">Target {it.sets} sets</span>{/if}
				</div>
			{/if}

			{#each single as m (m.id)}
				{@const prev = prevSummary(i)[m.id]}
				<div>
					{#if m.type === 'checkbox'}
						<label style="color: var(--text)"
							><input type="checkbox" class="tick" checked={!!log[i].summary[m.id]} onchange={(e) => (log[i].summary[m.id] = e.currentTarget.checked)} />
							{m.name}{m.required ? ' *' : ''}</label
						>
					{:else if m.type === 'choice'}
						<label>{m.name}{m.required ? ' *' : ''}
							<select value={num(log[i].summary[m.id])} onchange={(e) => (log[i].summary[m.id] = e.currentTarget.value)}>
								<option value=""></option>
								{#each m.choices ?? [] as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
							</select>
						</label>
					{:else if m.type === 'text' && isLong(m)}
						<NoteBox
							label="{m.name}{m.required ? ' *' : ''}"
							placeholder="Write here. Markdown works."
							rows={6}
							bind:value={() => num(log[i].summary[m.id]), (v) => (log[i].summary[m.id] = v)}
						/>
					{:else if m.type === 'text'}
						<label>{m.name}{m.required ? ' *' : ''} <input value={num(log[i].summary[m.id])} oninput={(e) => (log[i].summary[m.id] = e.currentTarget.value)} /></label>
					{:else if isNumeric(m)}
						<span class="field-label">
							{m.name}{m.unit ? ` (${m.unit})` : m.type === 'duration' ? ' (min)' : ''}{m.required ? ' *' : ''}
							{#if targetAt(it, m.id) !== undefined}<span class="small-text">· {data.levels ? levelNames[level].toLowerCase() : 'target'} {targetAt(it, m.id)}</span>{/if}
							{#if prev !== undefined && isOpen}<span class="small-text">· last time {prev}</span>{/if}
						</span>
						<Stepper value={log[i].summary[m.id] as number | null} step={stepOf(m)} label={m.name}
							changed={changedSummary(i, m.id)} onchange={(v) => (log[i].summary[m.id] = v)} />
						{#if m.type === 'duration' && !quickMode && !data.past}
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

			{#if isYesNo(it) && !quickMode}
				<label style="color: var(--text)"><input type="checkbox" class="tick" bind:checked={log[i].tick} aria-label="{t.name} done" /> Done</label>
			{/if}
		{/if}
	</section>
	{/if}
{/each}

{#if data.items.length === 0}
	<p class="muted">This habit has nothing to log. Add Tasks to it in the Habit editor, or mark it done from Today.</p>
{/if}
{#if data.orphanNames.length && !quickMode}
	<p class="muted small-text">This log also has values for {data.orphanNames.join(', ')}, which {data.orphanNames.length === 1 ? 'is' : 'are'} no longer in this habit. They are kept.</p>
{/if}

{#if quickMode}
	<p class="muted small-text"><a href="/log/{data.occurrence.id}">Open the full log</a> to change anything else.</p>
{:else}
	<div style="margin-top: 1rem"><NoteBox bind:value={notes} label="Notes" rows={2} /></div>
{/if}

{#if problem}<p class="error">{problem}</p>{/if}
{#if asking}
	{@const one = askUnticked + askSuggested.length === 1}
	<div class="card stack" role="alert">
		<p style="margin: 0">{askText}</p>
		<div class="row">
			<button type="button" class="primary" onclick={() => finishWith(false)}
				>{askSuggested.length ? 'No, save only what I logged' : 'No, save only the ticked sets'}</button
			>
			<button type="button" onclick={() => finishWith(true)}
				>{askSuggested.length ? `Yes, keep ${one ? 'it' : 'them'} and finish` : `Yes, tick ${one ? 'it' : 'them all'} and finish`}</button
			>
		</div>
	</div>
{/if}
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
{#if form?.error}<p class="error">{form.error}</p>{/if}
{#if form?.saved}<p class="muted">Saved.</p>{/if}

{#if data.canLog || data.occurrence.status === 'done'}
<div class="actions">
	<form
		method="POST"
		action="?/save"
		class="grow-form"
		bind:this={finishForm}
		use:enhance={({ cancel }) => {
			problem = '';
			// An answer to the unticked-sets question covers this one press of Finish only.
			const answered = untickedAnswered;
			untickedAnswered = false;
			const gaps = missing();
			if (gaps.length) {
				problem = `Fill in: ${gaps.join(', ')}`;
				cancel();
				return;
			}
			const unticked = answered ? 0 : untickedSets();
			const suggested = answered ? [] : suggestedPlaces();
			if (unticked || suggested.length) {
				askUnticked = unticked;
				askSuggested = suggested;
				cancel();
				return;
			}
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
		<button class="primary big">{data.occurrence.status === 'done' ? 'Save changes' : quickMode ? 'Save' : 'Finish'}</button>
	</form>
</div>
{/if}

{#if restLeft !== null}
	<div style="height: 4rem" aria-hidden="true"></div>
	<div class="rest" role="status">
		{#if restLeft > 0}
			Rest {Math.floor(restLeft / 60)}:{String(restLeft % 60).padStart(2, '0')}
		{:else}
			Rest over, next set
		{/if}
		<button class="small" onclick={() => (restEnd = null)}>Dismiss</button>
	</div>
{/if}

<style>
	.elsewhere {
		/* In view wherever you type, without moving what you type in. */
		position: sticky;
		bottom: calc(4.2rem + env(safe-area-inset-bottom));
		z-index: 4;
		margin-top: 0.75rem;
		border-color: var(--danger);
	}
	.elsewhere p {
		margin: 0 0 0.6rem;
	}
	.past {
		margin: -0.5rem 0 0.75rem;
	}
	.nested {
		border-left: 3px solid var(--border);
	}
	.round {
		margin: 0.75rem 0 0.35rem;
		font-size: 0.9rem;
		color: var(--muted);
		font-weight: 600;
	}
	label.step {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		color: var(--text);
		padding: 0.3rem 0 0.3rem 0.6rem;
		margin-bottom: 0.25rem;
		border-left: 3px solid var(--border);
	}
	.levels {
		border: 1px solid var(--border);
		margin-bottom: 0.75rem;
	}
	.repeat {
		align-items: center;
		margin-bottom: 0.75rem;
	}
	.field-label {
		display: block;
		font-size: 0.9rem;
		color: var(--muted);
	}
	.grow-form {
		flex: 1;
	}
	button.big {
		width: 100%;
		padding: 0.8rem;
		font-size: 1.05rem;
	}
	input.tick {
		width: 1.4rem;
		height: 1.4rem;
	}
	.sets {
		width: 100%;
		border-collapse: collapse;
	}
	.sets th {
		text-align: left;
		font-size: 0.8rem;
		color: var(--muted);
		font-weight: 500;
		padding: 0 0.25rem 0.25rem;
	}
	.sets td {
		padding: 0.2rem 0.25rem;
	}
	.sets td:first-child {
		color: var(--muted);
		width: 2rem;
	}
	.sets tr.done :global(input[type='number']) {
		border-color: var(--accent);
	}
	.recap {
		margin: 0.15rem 0 0.6rem;
	}
	.small-text {
		font-size: 0.85rem;
	}
	.howto {
		margin: 0 0 0.6rem;
	}
	.howto summary {
		cursor: pointer;
		color: var(--accent);
	}
	.howto-body {
		margin-top: 0.4rem;
		padding: 0.5rem 0.6rem;
		border-left: 3px solid var(--border);
	}
	.swap summary {
		cursor: pointer;
		color: var(--accent);
	}
	.swap[open] {
		flex-basis: 100%;
	}
	.rest {
		position: fixed;
		left: 1rem;
		right: 1rem;
		bottom: 4.5rem;
		max-width: 608px;
		margin: 0 auto;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		border-radius: var(--radius);
		background: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.rest button {
		color: var(--text);
	}
</style>
