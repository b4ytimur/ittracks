<script lang="ts">
	import { metricTypes } from '$lib/metric-types';
	import CardGrid from '$lib/stats/ui/CardGrid.svelte';
	import { tick, untrack, type Snippet } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import type { ActionData, PageData } from './$types';
	import SaidLine from '$lib/detail/SaidLine.svelte';
	import * as W from '$lib/detail/words';
	import EditableList from '$lib/ui/EditableList.svelte';
	import { focusOn, rowOf } from '$lib/ui/focus';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import GroupHeading from '$lib/ui/GroupHeading.svelte';
	import type { Way } from '$lib/ui/MenuButton.svelte';
	import { dismiss, showToast } from '$lib/toast.svelte';
	import { enhance } from '$app/forms';
	import { deleteHere, goneAt } from '$lib/undelete';
	import { noteDefaults, rowWords, type MetricForm, type TaskForm } from '$lib/forms';
	import NoteBox from '$lib/NoteBox.svelte';
	import OptionList from '$lib/OptionList.svelte';
	import { defaultStep, metricsFromType, type TaskType } from '$lib/task-types';
	import { blocked } from '$lib/rules/core';
	import { checkTask, checkTaskPast, metricPast, metricRules, readyToSave, taskRules, unfinishedMetric } from '$lib/rules/task';
	import { allowedNow, lockedNow } from '$lib/rules/history';
	import type { UnitChoice } from '$lib/units';
	import { units } from '$lib/units-here';
	import { groups } from '$lib/groupings-here';
	import { promptFor } from '$lib/journal';

	let {
		data,
		form,
		openLines = [],
		onreset
	}: {
		data: PageData;
		form: ActionData;
		openLines?: string[];
		/** Start over from what the server has, with these lines open. */
		onreset: (open?: string[]) => unknown;
	} = $props();

	// The editor works on a local copy; the whole thing is sent as JSON on save.
	let t = $state<TaskForm>(untrack(() => structuredClone(data.task)));
	let newTag = $state('');

	// Conflict rules (src/lib/rules): what is blocked right now, and why.
	const restBlock = $derived(blocked(taskRules, t, 'restTimerEnabled', undefined));
	const quickBlock = (m: MetricForm) => blocked(metricRules, m, 'quick', undefined);
	const prefillBlock = (m: MetricForm) => blocked(metricRules, m, 'prefill', undefined);
	const longBlock = (m: MetricForm) => blocked(metricRules, m, 'long', undefined);
	const repeatsBlock = (m: MetricForm) => blocked(metricRules, m, 'repeats', undefined);
	const today = new Date().toISOString().slice(0, 10);

	// History policies (src/lib/rules/history.ts): what an edit may do to data already logged.
	let unitChoices = $state<Record<string, UnitChoice>>({});
	const past = $derived(data.isNew ? null : checkTaskPast(data.task, t, data.logged, units(), unitChoices));
	const isLogged = (id: string) => data.logged.metrics.includes(id);
	/** A part with anything logged under it: removing it archives it, so past logs keep their place. */
	const partLogged = (id: string) => data.logged.parts.includes(id);
	const choiceOf = (id: string) => data.library.find((l) => l.id === id);
	const numericType = (type: string) => type === 'number' || type === 'count' || type === 'duration';
	let addPart = $state('');
	function addLibraryPart(taskId: string) {
		if (!taskId) return;
		const id = crypto.randomUUID();
		t.parts.push({ kind: 'task', id, taskId, sets: null, targets: {}, minTargets: {}, stretchTargets: {} });
		addPart = '';
		void focusOn(`${rowOf(id)} a`);
	}
	/** A new step, with focus in its name: typing goes there, not to the button again. */
	function addStep() {
		const id = crypto.randomUUID();
		t.parts.push({ kind: 'step', id, name: '' });
		void focusOn(`${rowOf(id)} input`);
	}
	function setPartTarget(map: Record<string, number>, id: string, v: string) {
		if (v === '' || !Number.isFinite(Number(v))) delete map[id];
		else map[id] = Number(v);
	}
	/** Sets on this Task repeat what's inside it, unless it has fields of its own logged per set. */
	const roundsHere = $derived(t.parts.length > 0 && !t.metrics.some((m) => m.repeats));
	const savedMetric = (id: string) => data.task.metrics.find((x) => x.id === id);
	/** May this field switch to `type` now? Logged numbers can only become another kind of number. */
	const typeOk = (m: MetricForm, type: string) => {
		const was = savedMetric(m.id);
		return !was || allowedNow(metricPast, 'type', isLogged(m.id), was.type, type);
	};
	const typeLocked = (m: MetricForm) => (savedMetric(m.id) ? lockedNow(metricPast, 'type', isLogged(m.id)) : null);
	const repeatsLocked = (m: MetricForm) => (savedMetric(m.id) ? lockedNow(metricPast, 'repeats', isLogged(m.id)) : null);
	const unitEdit = (m: MetricForm) => past?.units.find((u) => u.metricId === m.id) ?? null;
	/** 100 kg as lb, for the "convert" choice: two decimals are enough to read. */
	const sample = (f: number) => Math.round(100 * f * 100) / 100;
	// Only choices for unit changes still in the form are sent.
	const unitsPayload = $derived(
		JSON.stringify(Object.fromEntries((past?.units ?? []).filter((u) => u.choice).map((u) => [u.metricId, u.choice])))
	);
	/** Numbers per option are on while any option has one. */
	const scored = (m: MetricForm) => Object.keys(m.scores).length > 0;
	function toggleScores(m: MetricForm, on: boolean) {
		// A falling scale by default: the first option is the best (Great = 5 ... Bad = 1).
		m.scores = on ? Object.fromEntries(m.choices.map((c, i) => [c.id, m.choices.length - i])) : {};
	}
	/** Set or clear the number of option `c` (its id). */
	function setScore(m: MetricForm, c: string, v: string) {
		const n = Number(v);
		const next = { ...m.scores };
		if (v === '' || !Number.isFinite(n)) delete next[c];
		else next[c] = n;
		m.scores = next;
	}
	let newLevel = $state<number | null>(null);
	/** A tag's levels, weakest first, with the one it has even when that is off the list. */
	const levelsOf = (tag: string, has = 0) => groups().of(tag).levels.filter((l) => !l.off || l.id === has).reverse();
	const levelNow = $derived(levelsOf(newTag).some((l) => l.id === newLevel) ? newLevel! : (levelsOf(newTag)[Math.floor(levelsOf(newTag).length / 2)]?.id ?? 1));

	const typeLabels: Record<string, string> = {
		number: 'Number (e.g. weight)',
		count: 'Count (e.g. reps)',
		duration: 'Duration (minutes)',
		checkbox: 'Checkbox (done?)',
		choice: 'Choice (pick one)',
		text: 'Text (a word or a journal entry)'
	};

	function addTag() {
		const name = newTag.trim();
		if (!name || t.tags.some((g) => g.name.toLowerCase() === name.toLowerCase())) return;
		t.tags.push({ name, level: levelNow });
		newTag = '';
	}

	function addMetric(preset?: Partial<MetricForm>) {
		const id = crypto.randomUUID();
		openFields[id] = true;
		t.metrics.push({
			id,
			name: '',
			type: 'number',
			unit: '',
			repeats: false,
			choices: [],
			prefill: 'last',
			step: null,
			required: false,
			quick: true,
			...noteDefaults(),
			...preset
		});
		void focusOn(`${rowOf(id)} input`);
	}

	/** Start from a Task type: its fields replace the current ones. */
	let typeKey = $state('');
	function applyType(type: TaskType) {
		typeKey = type.key;
		t.metrics = metricsFromType(type, units());
		t.restTimerEnabled = type.restTimerEnabled;
		Object.assign(t, rowWords(), type.words);
	}

	let typeName = $state('');
	const typePayload = $derived(
		JSON.stringify({
			name: typeName,
			restTimerEnabled: t.restTimerEnabled,
			words: { rowOne: t.rowOne, rowMany: t.rowMany, betweenName: t.betweenName },
			metrics: t.metrics.map((m) => ({ name: m.name, type: m.type, unit: m.unit, repeats: m.repeats, step: m.step, ...(m.times ? { times: true } : {}), ...(m.better === 'less' ? { better: 'less' } : {}), ...(m.sameDay === 'replace' ? { sameDay: 'replace' } : {}) }))
		})
	);

	const toggleCollection = (id: string) =>
		(t.collectionIds = t.collectionIds.includes(id) ? t.collectionIds.filter((x) => x !== id) : [...t.collectionIds, id]);
	const isNumeric = (m: MetricForm) => m.type === 'number' || m.type === 'count' || m.type === 'duration';
	const ago = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

	// ----- Lines: each saves by itself; what touches logged values waits for its own Save -----

	type Key = keyof TaskForm;
	const LINES: Record<string, { label: string; fields: Key[] }> = {
		name: { label: 'Name', fields: ['name'] },
		fields: { label: 'What you log', fields: ['metrics'] },
		parts: { label: 'Inside this Task', fields: ['parts'] },
		rest: { label: 'Rest', fields: ['restTimerEnabled', 'restTimerSeconds'] },
		words: { label: 'Its words', fields: ['rowOne', 'rowMany', 'betweenName'] },
		notes: { label: 'How to', fields: ['notes'] },
		tags: { label: 'Tags', fields: ['tags'] },
		area: { label: 'Area', fields: ['areaId'] },
		collections: { label: 'Collections', fields: ['collectionIds'] }
	};
	const ordered = (v: unknown): string =>
		JSON.stringify(v ?? null, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
	const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v ?? null));
	let base = $state.raw(untrack(() => copy(data.task)));
	/** What the lines send: a field or step still being typed waits, so a rename beside it still saves. */
	const sent = $derived(data.isNew ? t : readyToSave(t, base));
	const waiting = $derived(
		data.isNew
			? []
			: [
					...t.metrics.filter(unfinishedMetric).map((m) => m.name.trim() || base.metrics.find((x) => x.id === m.id)?.name || 'The new field'),
					...t.parts.filter((p) => p.kind === 'step' && !p.name.trim()).map((p) => (base.parts.find((x) => x.id === p.id) as { name?: string } | undefined)?.name || 'The new step')
				]
	);
	const changedKey = (k: Key) => ordered(sent[k]) !== ordered(base[k]);
	/** Checked as the lines send it, so a field still being typed isn't red: it waits, said quietly. */
	const ruleCheck = $derived(checkTask(sent));
	const edited = $derived(Object.fromEntries(Object.entries(LINES).map(([id, l]) => [id, l.fields.some(changedKey)])));
	/** Fields and steps with logs that this change takes away, by name. */
	const goneFields = $derived(base.metrics.filter((m) => isLogged(m.id) && !t.metrics.some((x) => x.id === m.id)).map((m) => m.name));
	const goneParts = $derived(base.parts.filter((p) => partLogged(p.id) && !t.parts.some((x) => x.id === p.id)));
	const holds = (id: string) => !data.isNew && edited[id] && (id === 'fields' ? (past?.units.length ?? 0) > 0 || goneFields.length > 0 : id === 'parts' ? goneParts.length > 0 : false);
	const effectOf = (id: string) =>
		id === 'fields'
			? [
					goneFields.length ? `${goneFields.join(', ')} ${goneFields.length === 1 ? 'has' : 'have'} logged values. They stay in History and Stats; targets set on ${goneFields.length === 1 ? 'it' : 'them'} in habits go.` : '',
					past?.units.length ? 'What is logged follows the choice above.' : ''
				]
					.filter(Boolean)
					.join(' ')
			: 'It has logs. They keep their place in past logs.';

	let opened = $state<Record<string, boolean>>(untrack(() => Object.fromEntries((data.isNew ? ['name', 'fields', ...openLines] : openLines).map((k) => [k, true]))));
	let added = $state<Record<string, boolean>>({});
	let problems = $state<Record<string, string>>({});
	let saving = $state<Record<string, boolean>>({});
	let elsewhere = $state<{ id: string; moved: Partial<TaskForm> } | null>(null);
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	const said = new Map<string, { entry: number; was: Partial<TaskForm> }>();
	const pick = (f: TaskForm, keys: Key[]) => Object.fromEntries(keys.map((k) => [k, copy(f[k])])) as Partial<TaskForm>;

	/** Its own, read once: an Undo in the band is pressed on other pages too, where `data` is theirs. */
	const TASK = untrack(() => data.taskId);
	async function send(body: object): Promise<{ status: number; r: { form?: TaskForm; undo?: string; error?: string; moved?: Partial<TaskForm> } } | null> {
		const res = await fetch(`/api/tasks/${TASK}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => null);
		return res && { status: res.status, r: await res.json().catch(() => ({})) };
	}
	let onServer = $state.raw(untrack(() => copy(data.task)));
	async function saveLine(id: string) {
		const keys = LINES[id].fields.filter(changedKey);
		clearTimeout(timers.get(id));
		timers.delete(id);
		if (!keys.length) return;
		const held = holds(id);
		if (saving[id]) return void (held || wait(id));
		saving[id] = true;
		const set = pick(sent, keys);
		const was = pick(onServer, keys);
		const a = await send({ set, was, keep: held, units: id === 'fields' ? JSON.parse(unitsPayload) : {} });
		saving[id] = false;
		if (!a) return void (problems[id] = 'Not saved. Are you online? It is tried again when you change something here.');
		if (a.status === 409 && a.r.moved) return void (elsewhere = { id, moved: a.r.moved });
		if (!a.r.form) return void (problems[id] = a.r.error ?? 'Not saved.');
		problems[id] = '';
		base = { ...base, ...set };
		onServer = a.r.form;
		tell(id, was, a.r.undo);
		if (held) {
			flush();
			return void onreset(Object.keys(opened).filter((k) => opened[k]));
		}
		if (keys.some(changedKey)) wait(id);
	}
	function tell(id: string, was: Partial<TaskForm>, undo?: string) {
		const l = LINES[id];
		const name = t.name;
		if (undo) {
			showToast(`Changed ${l.label.toLowerCase()} of ${name}.`, async () => {
				const r = await fetch('/api/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: undo }) }).catch(() => null);
				if (!r?.ok) return r?.status === 409 ? `${name} changed again since, so it is left as it is.` : false;
				await onreset();
				return true;
			});
			return;
		}
		const first = said.get(id);
		if (first) dismiss(first.entry);
		const back = { ...was, ...(first?.was ?? {}) };
		const now = pick(onServer, Object.keys(back) as Key[]);
		const entry = showToast(id === 'name' ? `Renamed to ${name}.` : `Changed ${l.label.toLowerCase()} of ${name}.`, async () => {
			const a = await send({ set: back, was: now });
			if (!a?.r.form) return a?.status === 409 ? `${l.label} changed again since, so it is left as it is.` : false;
			said.delete(id);
			await onreset(Object.keys(opened).filter((k) => opened[k]));
			return true;
		});
		said.set(id, { entry, was: back });
	}
	function wait(id: string) {
		clearTimeout(timers.get(id));
		timers.set(id, setTimeout(() => saveLine(id), 800));
	}
	$effect(() => {
		if (data.isNew) return;
		const ids = Object.keys(LINES).filter((id) => edited[id] && !holds(id));
		void ordered(ids.map((id) => pick(t, LINES[id].fields)));
		untrack(() => ids.forEach(wait));
		// A change that became one to ask about is not sent by a timer from before.
		untrack(() => Object.keys(LINES).filter(holds).forEach((id) => (clearTimeout(timers.get(id)), timers.delete(id))));
	});
	const flush = () => [...timers.keys()].forEach((id) => void saveLine(id));
	beforeNavigate(flush);
	function cancelLine(id: string) {
		Object.assign(t, pick(base, LINES[id].fields));
		unitChoices = {};
		problems[id] = '';
	}
	function keepMine() {
		if (!elsewhere) return;
		onServer = { ...onServer, ...elsewhere.moved };
		const { id } = elsewhere;
		elsewhere = null;
		void saveLine(id);
	}

	const metricWords = (m: MetricForm) =>
		`${m.name || 'A field'}: ${typeLabels[m.type].replace(/ \(.*/, '').toLowerCase()}${m.unit ? ` in ${m.unit}` : ''}${m.repeats ? `, each ${t.rowOne}` : ''}`;
	const say = (f: TaskForm): Record<string, string> => ({
		name: f.name,
		fields: f.metrics.length ? W.sentence(f.metrics.map(metricWords).join('. ')) : 'Nothing to fill in: you tick it off.',
		parts: W.listWords(f.parts.map((p) => (p.kind === 'step' ? p.name : (choiceOf(p.taskId)?.name ?? 'A Task'))), 'Nothing inside it.'),
		rest: f.restTimerEnabled ? `${f.restTimerSeconds % 60 ? `${f.restTimerSeconds} s` : `${f.restTimerSeconds / 60} min`} between ${f.rowMany}.` : 'Off.',
		words: `One ${f.rowOne}, several ${f.rowMany}. ${f.betweenName} between them.`,
		notes: W.noteWords(f.notes),
		tags: W.listWords(f.tags.map((g) => `${g.name} ${groups().levelName(g.name, g.level)}`)),
		area: data.areas.find((a) => a.id === f.areaId)?.name ?? 'None.',
		collections: W.listWords(f.collectionIds.map((id) => data.collections.find((c) => c.id === id)?.name ?? ''), 'In none.')
	});
	const now = $derived(say(t));
	const before = $derived(say(base));
	const shows: Record<string, boolean> = $derived({
		rest: t.restTimerEnabled || base.restTimerEnabled || !!added.rest,
		notes: !!t.notes || !!added.notes,
		tags: t.tags.length > 0 || !!added.tags,
		parts: t.parts.length > 0 || base.parts.length > 0 || !!added.parts
	});
	const words: Record<string, string> = { rest: 'Rest between sets', notes: 'How to', tags: 'Tags', parts: 'Steps and Tasks inside it' };
	const toAdd = $derived(Object.keys(words).filter((id) => !shows[id] && (id !== 'rest' || !restBlock)));
	function add(id: string) {
		added[id] = true;
		opened[id] = true;
		if (id === 'rest') t.restTimerEnabled = true;
		tick().then(() => document.getElementById(`line-${id}`)?.scrollIntoView({ block: 'nearest' }));
	}
	const menu = $derived<(Way | '-')[]>(
		data.isNew
			? []
			: [
					{ label: 'Duplicate', action: '?/duplicate' },
					'-' as const,
					data.archived ? { label: 'Unarchive', action: '?/unarchive' } : { label: 'Archive', action: '?/archive' },
					{ label: 'Delete…', onselect: () => deleteHere('task', data.taskId, t.name, '/library') }
				]
	);
	/** Fields whose settings stand open; one just added does. */
	let openFields = $state<Record<string, boolean>>({});
</script>

<svelte:head><title>{data.isNew ? 'New task' : t.name} · ittracks</title></svelte:head>

{#snippet line(id: string, b: Snippet, lead = false)}
	<SaidLine
		{id}
		label={id === 'rest' ? t.betweenName : LINES[id].label}
		words={now[id] || 'Nothing yet.'}
		{lead}
		bind:open={() => !!opened[id], (v) => (opened[id] = v)}
		held={holds(id)}
		was={before[id]}
		effect={holds(id) ? effectOf(id) : ''}
		saving={saving[id]}
		problem={problems[id]}
		onsave={() => saveLine(id)}
		oncancel={() => cancelLine(id)}
	>
		{@render b()}
	</SaidLine>
{/snippet}

{#snippet namePart()}
	<label class="label" for="task-name">Name</label>
	<input id="task-name" bind:value={t.name} placeholder="Bench press" maxlength="120" required />
{/snippet}
{#snippet areaPart()}
	<div class="chips" role="group" aria-label="Area">
		<button type="button" class="toggle" aria-pressed={!t.areaId} onclick={() => (t.areaId = null)}>None</button>
		{#each data.areas as a (a.id)}<button type="button" class="toggle" aria-pressed={t.areaId === a.id} onclick={() => (t.areaId = a.id)}>{a.name}</button>{/each}
	</div>
{/snippet}
{#snippet collectionsPart()}
	<div class="chips" role="group" aria-label="Collections">
				{#each data.collections as c (c.id)}
					<button type="button" class="toggle" aria-pressed={t.collectionIds.includes(c.id)} onclick={() => toggleCollection(c.id)}>{c.name}</button>
				{/each}
	</div>
{/snippet}
{#snippet notesPart()}
	<NoteBox bind:value={t.notes} label="How to" hint="Markdown. Shows as “How to” on the log screen: form cues, a link to a video, a warm-up." />
{/snippet}
{#snippet tagsPart()}
	<p class="meta">Tags describe what a Task works on. Fill rules use them to pick Tasks for you.</p>
	{#each t.tags as g, i (g.name)}
		<div class="row">
			<span class="grow">{g.name}</span>
			<select bind:value={g.level} aria-label="Level for {g.name}" style="width: auto">
				{#each levelsOf(g.name, g.level) as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
			</select>
			<button type="button" class="quiet" onclick={() => t.tags.splice(i, 1)}>Remove</button>
		</div>
	{/each}
	<div class="row">
		<label class="grow"
			>New tag <input bind:value={newTag} list="all-tags" placeholder="triceps"
				onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())} /></label
		>
		<select bind:value={() => levelNow, (v) => (newLevel = v)} aria-label="Level" style="width: auto">
			{#each levelsOf(newTag) as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
		</select>
		<button type="button" onclick={addTag}>Add</button>
	</div>
{/snippet}
{#snippet restPart()}
	<div class="row">
		<label class="grow" style="color: var(--ink)"
			><input type="checkbox" bind:checked={t.restTimerEnabled} disabled={!!restBlock && !t.restTimerEnabled} /> Start a countdown after each {t.rowOne}</label
		>
		{#if restBlock}<p class="muted meta">{restBlock.reason}. Mark a field "Log per {t.rowOne}" first.</p>{/if}
		{#if t.restTimerEnabled}
			<label style="width: 8rem"
				>Seconds <input type="number" min="5" max="3600" bind:value={t.restTimerSeconds} /></label
			>
		{/if}
	</div>

{/snippet}
{#snippet wordsPart()}
	<p class="meta">What this Task calls one row of what you log, and the clock between two.</p>
	<div class="row">
		<label class="grow">One <input bind:value={t.rowOne} maxlength="20" placeholder="set" /></label>
		<label class="grow">Several <input bind:value={t.rowMany} maxlength="20" placeholder="sets" /></label>
		<label class="grow">The clock <input bind:value={t.betweenName} maxlength="20" placeholder="Rest" /></label>
	</div>
{/snippet}
{#snippet fieldsPart()}
	<p class="meta">The values you fill in. One marked "per {t.rowOne}" is logged again for every {t.rowOne}.</p>
	<EditableList
		items={t.metrics}
		key={(m) => m.id}
		label={(m) => m.name || 'Field'}
		mode="edit"
		layout="bare"
		ariaLabel="Fields"
		onmove={(_, order) => (t.metrics = order.map((k) => t.metrics.find((m) => m.id === k)!))}
	>
		{#snippet row(m, ctx)}
			<div class="field-row">
				<div class="field-head">
					<span class="slot">{@render ctx.grip?.()}</span>
					<strong class="grow">{m.name || 'New field'}</strong>
					<button type="button" class="quiet" aria-expanded={!!openFields[m.id]} aria-label="{openFields[m.id] ? 'Close' : 'Change'} {m.name || 'the new field'}" onclick={() => (openFields[m.id] = !openFields[m.id])}>{openFields[m.id] ? 'Close' : 'Change'}</button>
					<button type="button" class="quiet" aria-label="{isLogged(m.id) ? 'Archive' : 'Remove'} {m.name || 'the new field'}" onclick={() => (t.metrics = t.metrics.filter((x) => x !== m))}>{isLogged(m.id) ? 'Archive' : 'Remove'}</button>
				</div>
				{#if !openFields[m.id]}
					<p class="meta field-words">{metricWords(m).replace(/^[^:]*: /, '')}</p>
				{:else}
					<div class="stack field-body">
			<div class="row">
				<label class="grow">Name <input bind:value={m.name} placeholder="Weight" required /></label>
				<label class="grow"
					>Type
					<select bind:value={m.type}>
						{#each metricTypes as type (type)}<option value={type} disabled={!typeOk(m, type)}>{typeLabels[type]}</option>{/each}
					</select>
				</label>
				{#if m.type === 'number' || m.type === 'count' || m.type === 'duration'}
					<label style="width: 6rem">Unit <input bind:value={m.unit} placeholder={m.type === 'duration' ? 'min' : 'kg'} list="known-units" /></label>
				{/if}
			</div>
			{#if typeLocked(m)}
				<p class="muted meta">
					{isNumeric(m) ? 'Has logged values, so it can only switch between number, count and duration.' : 'Has logged values, so its type is fixed.'}
				</p>
			{/if}
			{#if unitEdit(m)}
				{@const u = unitEdit(m)!}
				<fieldset class="card past">
					<legend class="muted">Values {m.name || 'this field'} already has, in {u.from || 'no unit'}</legend>
					{#if u.change.kind === 'convertible'}
						<label style="color: var(--ink)"
							><input type="radio" name="unit-{m.id}" checked={u.choice === 'convert'} onchange={() => (unitChoices[m.id] = 'convert')} /> Convert them: 100 {u.from} becomes {sample(u.change.factor)} {u.to}</label
						>
					{/if}
					<label style="color: var(--ink)"
						><input type="radio" name="unit-{m.id}" checked={u.choice === 'relabel'} onchange={() => (unitChoices[m.id] = 'relabel')} /> Keep the numbers: they were already in {u.to || 'no unit'}</label
					>
					<p class="muted meta" style="margin: 0.25rem 0 0">
						{u.choice === 'convert'
							? 'Every logged value, Slot target and the targets kept with past logs are converted when you save.'
							: u.choice === 'relabel'
								? 'Nothing is converted: 100 stays 100, now read as ' + (u.to || 'no unit') + '.'
								: u.change.kind === 'convertible'
									? 'Pick one to save.'
									: `${u.from || 'No unit'} and ${u.to || 'no unit'} don't convert, so the numbers can only be kept. Pick it to save.`}
					</p>
				</fieldset>
			{/if}
			{#if m.type === 'choice'}
				<span class="meta muted">Options</span>
				<OptionList
					bind:options={m.choices}
					used={(id) => data.logged.options.includes(id)}
					label="Option"
					addLabel="Add option"
					placeholder="e.g. Great"
					usedTitle="Picked in past logs: they keep it, and a rename shows there too"
				>
					{#snippet after(o: { id: string; name: string })}
						{#if scored(m)}
							<input class="score" type="number" step="any" value={m.scores[o.id] ?? ''} oninput={(e) => setScore(m, o.id, e.currentTarget.value)} aria-label="Number for {o.name || 'this option'}" />
						{/if}
					{/snippet}
				</OptionList>
				{#if m.choices.length >= 2}
					<label style="color: var(--ink)"
						><input type="checkbox" checked={scored(m)} onchange={(e) => toggleScores(m, e.currentTarget.checked)} /> Give each option a number, so Stats can chart it (mood 5 to 1)</label
					>
					{#if scored(m) && isLogged(m.id)}<p class="muted meta">A changed number counts from today on: past days keep the numbers they had.</p>{/if}
				{/if}
			{/if}
			{#if m.type === 'text'}
				<label style="color: var(--ink)"
					><input type="checkbox" bind:checked={m.long} disabled={!!longBlock(m) && !m.long} /> Several lines (Markdown), for a journal entry or a reflection</label
				>
				{#if longBlock(m) && !m.long}<p class="muted meta">{longBlock(m)?.reason}.</p>{/if}
				{#if m.long}
					<label
						>Starter text <span class="meta">(fills each new log, like headings to write under)</span>
						<textarea bind:value={m.starter} rows="3" maxlength="2000" placeholder={'## Wins\n\n## Lessons'}></textarea>
					</label>
					<label
						>Prompts, one per line <span class="meta">(one shows each day and is saved with your answer)</span>
						<textarea
							value={m.prompts.join('\n')}
							oninput={(e) =>
								(m.prompts = e.currentTarget.value
									.split('\n')
									.map((s) => s.trim())
									.filter(Boolean)
									.slice(0, 100))}
							rows="3"
							placeholder={'What went well today?\nWhat would you do differently?'}
						></textarea>
					</label>
					{#if m.prompts.length}
						<div class="row">
							<label class="grow"
								>Which prompt each day
								<select bind:value={m.promptOrder}>
									<option value="order">In order, one a day</option>
									<option value="random">Random, the same all day</option>
								</select>
							</label>
						</div>
						<p class="muted meta">Today's prompt: “{promptFor(m, today)}”</p>
					{/if}
				{/if}
			{/if}
			<details class="log-settings">
				<summary class="meta">When logging</summary>
				{#if isNumeric(m)}
					<div class="row">
						{#if m.repeats}<label class="grow" style="color: var(--ink)"><input type="checkbox" bind:checked={m.times} /> Written after a ×, as in 60 kg × 8</label>{/if}
						<label class="grow" style="color: var(--ink)"><input type="checkbox" checked={m.better === 'less'} onchange={(e) => (m.better = e.currentTarget.checked ? 'less' : null)} /> Less is better</label>
					</div>
					{#if !m.repeats}
						<!-- Rule T3: a quick log or the AI logging it a second time in a day. -->
						<label
							>A second quick log the same day
							<select bind:value={m.sameDay}>
								<option value="add">Adds to it, like glasses of water</option>
								<option value="replace">Replaces it, like a weigh-in</option>
							</select>
						</label>
					{/if}
				{/if}
				<div class="row">
					{#if m.type === 'checkbox' || (m.type === 'text' && m.long)}
						<p class="muted meta grow">{prefillBlock({ ...m, prefill: 'last' })?.reason}.</p>
					{:else}
						<label class="grow"
							>Start with
							<select bind:value={m.prefill}>
								<option value="last">Last time's value</option>
								<option value="target" disabled={!isNumeric(m)}>The target{isNumeric(m) ? '' : ' (numbers only)'}</option>
								<option value="blank">Blank</option>
							</select>
						</label>
					{/if}
					{#if isNumeric(m)}
						<label style="width: 7rem"
							>+/− step
							<input type="number" step="any" min="0" value={m.step ?? ''} placeholder={String(defaultStep(m.type, m.unit, units()))}
								oninput={(e) => (m.step = e.currentTarget.value && Number(e.currentTarget.value) > 0 ? Number(e.currentTarget.value) : null)} />
						</label>
					{/if}
				</div>
				<label style="color: var(--ink)"
					><input type="checkbox" bind:checked={m.required} onchange={() => m.required && (m.quick = true)} /> Required before Finish</label
				>
				<label style="color: var(--ink)"
					><input type="checkbox" bind:checked={m.quick} disabled={m.required} /> Show on quick logs</label
				>
				{#if m.required}<p class="muted meta" style="margin: 0">{quickBlock({ ...m, quick: false })?.reason}.</p>{/if}
			</details>
			<div class="row">
				<label class="grow" style="color: var(--ink)"
					><input type="checkbox" bind:checked={m.repeats} disabled={!!repeatsLocked(m) || (!!repeatsBlock(m) && !m.repeats)} /> Log per {t.rowOne}</label
				>
			</div>
			{#if repeatsLocked(m)}<p class="muted meta">Has logged values, so “Log per {t.rowOne}” is fixed.</p>{/if}
					</div>
				{/if}
				{#if unitEdit(m) && !openFields[m.id]}<p class="meta field-words">Its unit changes: open it to say what happens to what is logged.</p>{/if}
			</div>
		{/snippet}
	</EditableList>
	<div class="row">
		<button type="button" onclick={() => addMetric()}>+ Field</button>
	</div>
{/snippet}
{#snippet partsPart()}
	<p class="meta">
		Steps you tick off, like "warm-up set", and Tasks from your Library that are logged inside this one, like the exercises of a circuit. A Task can sit inside several others.
		{#if roundsHere}Sets on this Task, in a habit, repeat everything inside it as rounds.{/if}
	</p>
	<EditableList
		items={t.parts}
		key={(p) => p.id}
		label={(p) => (p.kind === 'step' ? p.name || 'Step' : (choiceOf(p.taskId)?.name ?? 'Task'))}
		mode="edit"
		layout="bare"
		ariaLabel="Inside this Task"
		onmove={(_, order) => (t.parts = order.map((k) => t.parts.find((p) => p.id === k)!))}
	>
		{#snippet row(p, ctx)}
			<div class="field-row">
				<div class="field-head">
					<span class="slot">{@render ctx.grip?.()}</span>
				{#if p.kind === 'step'}
					<input class="grow" bind:value={p.name} aria-label="Step name" placeholder="Step" required />
				{:else}
					{@const c = choiceOf(p.taskId)}
					<a class="grow" href="/library/{p.taskId}">{c?.name ?? 'A Task'}</a>
				{/if}
					<button type="button" class="quiet" aria-label="{partLogged(p.id) ? 'Archive' : 'Remove'} {p.kind === 'step' ? p.name || 'the step' : (choiceOf(p.taskId)?.name ?? 'the Task')}" onclick={() => (t.parts = t.parts.filter((x) => x !== p))}>{partLogged(p.id) ? 'Archive' : 'Remove'}</button>
				</div>
				<div class="field-body">
			{#if p.kind === 'task'}
				{@const c = choiceOf(p.taskId)}
				{@const nums = (c?.metrics ?? []).filter((m) => numericType(m.type))}
				{#if c && (c.hasParts || c.metrics.some((m) => m.repeats))}
					<label class="sets-input"
						>{c.metrics.some((m) => m.repeats) ? 'Sets' : 'Rounds'}
						<input type="number" min="0" max="50" value={p.sets ?? ''} oninput={(e) => (p.sets = e.currentTarget.value ? Number(e.currentTarget.value) : null)} />
					</label>
				{/if}
				{#if nums.length}
					<table class="targets">
						<thead><tr><th></th><th>Minimum</th><th>Target</th><th>Stretch</th></tr></thead>
						<tbody>
							{#each nums as m (m.id)}
								<tr>
									<td>{m.name}{m.unit ? ` (${m.unit})` : ''}</td>
									<td><input type="number" step="any" inputmode="decimal" value={p.minTargets[m.id] ?? ''} oninput={(e) => setPartTarget(p.minTargets, m.id, e.currentTarget.value)} aria-label="{m.name} minimum" /></td>
									<td><input type="number" step="any" inputmode="decimal" value={p.targets[m.id] ?? ''} oninput={(e) => setPartTarget(p.targets, m.id, e.currentTarget.value)} aria-label="{m.name} target" /></td>
									<td><input type="number" step="any" inputmode="decimal" value={p.stretchTargets[m.id] ?? ''} oninput={(e) => setPartTarget(p.stretchTargets, m.id, e.currentTarget.value)} aria-label="{m.name} stretch" /></td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			{/if}
				</div>
			</div>
		{/snippet}
	</EditableList>
	{#if t.parts.some((p) => p.kind === 'task')}
		<p class="muted meta" style="margin: 0 0 0.5rem">
			Targets set here apply in every habit that uses this Task. Minimum and Stretch count in habits with levels on.
		</p>
	{/if}
	<div class="row">
		<button type="button" onclick={addStep}>Add a step</button>
		<!-- Picked, then added with its button: arrow keys pass through the list without adding. -->
		<select class="grow" bind:value={addPart} aria-label="A Task from your Library">
			<option value="">Add a Task from your Library…</option>
			{#each data.library as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
		</select>
		<button type="button" disabled={!addPart} onclick={() => addLibraryPart(addPart)}>Add</button>
	</div>

{/snippet}

<EditChrome
	title={data.isNew ? 'New task' : t.name || 'Task'}
	back={{ href: '/library', label: 'Library' }}
	modes={['use']}
	hints={data.usage
		? {
				use: [
					data.usage.habits.length ? `In ${data.usage.habits.map((h) => h.name).join(', ')}` : 'Not used in any habit',
					data.usage.inside.length ? `inside ${data.usage.inside.map((p) => p.name).join(', ')}` : '',
					data.usage.lastLogged ? `logged ${data.usage.timesLogged} ${data.usage.timesLogged === 1 ? 'time' : 'times'}, last on ${ago(data.usage.lastLogged)}` : ''
				]
					.filter(Boolean)
					.join(' · ')
			}
		: {}}
	more={menu}
/>

{#if data.archived}
	<form method="POST" action="?/unarchive" class="notice" use:enhance>
		<span class="notice-text">{data.deleteAfter ? `Deleted. It goes for good with its logs on ${goneAt(data.deleteAfter)}.` : 'This Task is archived: hidden from the Library and pickers, with its history kept.'}</span>
		<span class="notice-acts"><button class="quiet">{data.deleteAfter ? 'Put back' : 'Unarchive'}</button></span>
	</form>
{/if}
{#if elsewhere}
	<div class="notice" data-tone="warn" role="alert">
		<span class="notice-text">{LINES[elsewhere.id].label} changed on another device: {say({ ...base, ...elsewhere.moved } as TaskForm)[elsewhere.id]}. Yours isn't saved.</span>
		<span class="notice-acts"><button type="button" class="quiet" onclick={() => onreset([elsewhere!.id])}>Show it</button><button type="button" class="quiet" onclick={keepMine}>Keep mine</button></span>
	</div>
{/if}

{#if data.isNew}
	<div class="card">
		<span class="muted meta">Start from a type</span>
		<div class="chips">
			{#each data.types as type (type.key)}
				<button type="button" class="toggle" aria-pressed={typeKey === type.key} onclick={() => applyType(type)}>{type.name}</button>
			{/each}
		</div>
		{#if typeKey}<p class="muted meta" style="margin: 0.4rem 0 0">{data.types.find((x) => x.key === typeKey)?.description}</p>{/if}
	</div>
{/if}

<datalist id="known-units">
		{#each units().names() as u (u)}<option value={u}></option>{/each}
	</datalist>
<datalist id="all-tags">
		{#each data.allTags as name (name)}<option value={name}></option>{/each}
	</datalist>


{#snippet lines()}
	<div class="card su-lines">
		{@render line('name', namePart, true)}
		{#if shows.notes}{@render line('notes', notesPart)}{/if}
	</div>
	<GroupHeading title="What you log" />
	<div class="card su-lines">
		{@render line('fields', fieldsPart)}
		{#if t.metrics.some((m) => m.repeats) || t.parts.some((p) => p.kind === 'task')}{@render line('words', wordsPart)}{/if}
		{#if shows.rest}{@render line('rest', restPart)}{/if}
		{#if shows.parts}{@render line('parts', partsPart)}{/if}
	</div>
	<GroupHeading title="About" />
	<div class="card su-lines">
		{@render line('area', areaPart)}
		{#if data.collections.length}{@render line('collections', collectionsPart)}{/if}
		{#if shows.tags}{@render line('tags', tagsPart)}{/if}
	</div>
	{#if toAdd.length}
		<div class="chips add-more" role="group" aria-label="Add to this Task">
			{#each toAdd as id (id)}<button type="button" onclick={() => add(id)}>+ {words[id]}</button>{/each}
		</div>
	{/if}
	{#if waiting.length}<p class="muted meta">{waiting.join(', ')} {waiting.length === 1 ? 'is' : 'are'} saved once finished: a field or step needs a name, and a Choice two options.</p>{/if}
	{#each [...new Set([...ruleCheck.errors, ...(past?.errors ?? [])].map((i) => i.reason))] as reason (reason)}<p class="error">{reason}</p>{/each}
	{#each [...new Set(ruleCheck.warnings.map((i) => i.reason))] as reason (reason)}<p class="muted meta">{reason}.</p>{/each}

{/snippet}

{#if data.isNew}
	<form method="POST" action="?/save" class="stack" use:enhance={() => async ({ update }) => update({ reset: false })}>
		<input type="hidden" name="payload" value={JSON.stringify(t)} />
		<input type="hidden" name="units" value={unitsPayload} />
		{@render lines()}
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		<div class="actions-bar l-stack">
			<div class="l-cluster">
				<button class="primary">Save task</button>
				<a class="button" href="/library">Cancel</a>
			</div>
		</div>
	</form>
{:else}
	{@render lines()}
{/if}

{#if data.history?.items.length}
	<details class="disclosure task-history" open>
		<summary><span class="chev" aria-hidden="true">›</span> Last times</summary>
		<CardGrid
			items={data.history.items}
			where={{ board: '' }}
			board={{ range: '90d', filter: { areas: [], tags: [], habit: null, identity: null, direction: 'all' } }}
			catalog={data.history.catalog}
			measures={data.history.measures}
			hidden={[]}
			suggested={[]}
			gallery={[]}
			readonly
			csv={(id) => `/stats/export?task=${data.taskId}&card=${id}`}
		/>
	</details>
{/if}

{#if t.metrics.length}
	<details class="disclosure save-type">
		<summary><span class="chev" aria-hidden="true">›</span> Save these fields as a Task type</summary>
		<form method="POST" action="?/saveType" class="row" use:enhance={() => async ({ update }) => update({ reset: false })}>
			<input type="hidden" name="type" value={typePayload} />
			<input class="grow" bind:value={typeName} placeholder="Type name, e.g. Swimming" aria-label="Type name" />
			<button disabled={!typeName.trim()}>Save type</button>
		</form>
		{#if form?.typeSaved}<p class="muted meta">Saved "{form.typeSaved}". It's offered when you make a new Task.</p>{/if}
	</details>
{/if}

<style>
	p {
		margin: 0;
	}
	.add-more {
		margin-block: var(--space-section) var(--space-group);
	}
	.task-history,
	.save-type {
		margin-block-start: var(--space-section);
	}
	.field-row {
		padding-block: var(--space-inline);
	}
	.field-head {
		display: flex;
		align-items: center;
		gap: var(--space-inline);
	}
	.field-head .grow {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.field-head .slot {
		width: var(--handle-slot);
		display: flex;
	}
	.field-words,
	.field-body {
		margin-inline-start: calc(var(--handle-slot) + var(--space-inline));
	}
	.field-body {
		padding-block: var(--space-inline);
	}
	.score {
		width: 4rem;
	}
	.log-settings summary {
		cursor: pointer;
		color: var(--accent-ink);
	}
	.log-settings[open] > * + * {
		margin-top: var(--space-inline);
	}
	.past {
		margin: 0;
	}
	.sets-input {
		width: 7rem;
	}
	.targets input {
		width: 5rem;
	}
	.targets th {
		text-align: left;
		font-size: var(--font-size-chip);
		color: var(--ink-muted);
		font-weight: 500;
	}
</style>
