<script lang="ts">
	import { describeSchedule } from '$lib/describe';
	import { flatten } from '$lib/engine/tree';
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import ViewBar from '$lib/ViewBar.svelte';
	import { viewOp } from '$lib/viewclient';
	import { showToast } from '$lib/toast.svelte';
	import { HABIT_LINES, groupBy, passes, type HabitLineKey } from '$lib/views';

	let { data } = $props();

	let views = $state(untrack(() => data.views));
	let viewDismissed = $state(false);
	async function switchView(id: string, name: string) {
		const r = await viewOp({ op: 'template', id });
		if (!r) return showToast("Couldn't switch. Are you online?");
		const before = r.previous;
		views = r.views;
		viewDismissed = true;
		showToast(`Switched to ${name}.`, async () => {
			const back = await viewOp({ op: 'restore', views: before });
			if (back) views = back.views;
		});
	}
	let view = $state(untrack(() => data.initial));
	const show = (k: HabitLineKey) => views.habits.lines.includes(k);
	function toggleLine(k: HabitLineKey) {
		const lines = show(k) ? views.habits.lines.filter((x) => x !== k) : [...views.habits.lines, k];
		views.habits = { ...views.habits, lines };
		viewOp({ op: 'patch', habits: { lines } });
	}

	const area = (id: string | null) => data.areas.find((a) => a.id === id);
	const shown = $derived.by(() => {
		const list = data.habits.filter((h) => (view.archived || !h.archived) && passes(view, h));
		if (view.sort === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name));
		if (view.sort === 'consistency') return [...list].sort((a, b) => (b.consistency ?? -1) - (a.consistency ?? -1));
		if (view.sort === 'created') return [...list].sort((a, b) => b.createdAt - a.createdAt);
		return list;
	});
	const groups = $derived(groupBy(shown, view.group, { areas: data.areas }));
	const identityNames = $derived([...new Set(data.habits.flatMap((h) => h.identities))].sort());
	const cueText = (c: { time: string | null; range?: string | null } | null) => c?.time ?? c?.range ?? null;
	const ago = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
	const lineFor = (h: (typeof data.habits)[number]) => {
		const a = area(h.areaId);
		return [
			show('schedule') ? (h.direction === 'break' ? 'Break habit' : describeSchedule(h.schedule)) : null,
			show('cue') ? cueText(h.cue) : null,
			show('area') && a && view.group !== 'area' ? `${a.icon} ${a.name}` : null,
			show('consistency') && h.consistency !== null ? `${h.consistency}% in 30 days` : null,
			show('last') && h.direction !== 'break' ? (h.lastDone ? `last done ${ago(h.lastDone)}` : 'not done yet') : null
		]
			.filter(Boolean)
			.join(' · ');
	};
</script>

<svelte:head><title>Habits · ittracks</title></svelte:head>

<header class="bar">
	<h1>Habits</h1>
	<div class="row" style="align-items: center">
		{#if !views.hidden.includes('identities')}<a href="/identities">Identities</a>{/if}
		<a href="/gallery">Gallery</a>
		<a class="button primary" href="/habits/new" data-sveltekit-reload>New habit</a>
	</div>
</header>

{#if data.added}
	<p class="card added">
		Added "{data.added}"{data.created ? ` with ${data.created} new ${data.created === 1 ? 'Task' : 'Tasks'}` : ''}{data.reused
			? `${data.created ? ',' : ''} using ${data.reused} from your Library`
			: ''}. It's on Today when it's due.
	</p>
{/if}
{#if data.suggestView && !viewDismissed}
	{@const sv = data.suggestView}
	<div class="card added stack">
		<span>This habit works well with the <strong>{sv.name}</strong> view. {sv.summary}</span>
		<div class="row">
			<button class="small primary" onclick={() => switchView(sv.id, sv.name)}>Switch to {sv.name}</button>
			<button class="small" onclick={() => (viewDismissed = true)}>No thanks</button>
		</div>
	</div>
{/if}

{#if data.habits.length === 0}
	<p class="muted">
		A habit can be something to build, like a gym plan or language practice, or something to
		break, like smoking. <a href="/gallery">Pick a ready-made one</a> or <a href="/habits/new" data-sveltekit-reload>create your own</a>.
	</p>
{/if}

{#if data.habits.length}
	<ViewBar
		page="habits"
		bind:views
		bind:current={view}
		areas={data.areas}
		identities={views.hidden.includes('identities') ? [] : identityNames}
		direction
		archived
	>
		<fieldset>
			<legend class="small-text">Lines on each habit</legend>
			{#each Object.entries(HABIT_LINES) as [k, label] (k)}
				<label style="color: var(--text)"
					><input type="checkbox" checked={show(k as HabitLineKey)} onchange={() => toggleLine(k as HabitLineKey)} /> {label}</label
				>
			{/each}
		</fieldset>
	</ViewBar>
	{#if !shown.length}<p class="muted">No habits match these filters.</p>{/if}
{/if}

{#each groups as g (g.key)}
	{#if g.label}
		<h2 class="area" style="--c: {g.color ?? 'var(--border)'}">{g.label}</h2>
	{/if}
	<ul class="list">
		<!-- A habit inside a group sits under it, indented; one whose group isn't listed sits at the top. -->
		{#each flatten(g.items) as { node: h, depth } (h.id)}
			{@const a = area(h.areaId)}
			<li style:margin-left={depth ? `${depth * 1.25}rem` : null}>
				<a class="card habit" href="/habits/{h.id}" data-sveltekit-reload style="--c: {a?.color ?? 'transparent'}">
					<strong>{h.name}</strong>
					{#if h.archived}<span class="chip">Archived</span>{/if}
					{#if lineFor(h)}<div class="muted" style="font-size: 0.9rem">{lineFor(h)}</div>{/if}
				</a>
			</li>
		{/each}
	</ul>
{/each}

<p style="margin-top: 1rem"><a class="button" href="/habits/import">Import a template file</a></p>

<style>
	.habit {
		border-left: 4px solid var(--c);
	}
	.added {
		border-color: var(--accent);
		margin-bottom: 0.75rem;
	}
	h2.area {
		border-left: 4px solid var(--c);
		padding-left: 0.5rem;
	}
	.small-text {
		font-size: 0.85rem;
	}
	fieldset {
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.chip {
		margin-left: 0.35rem;
	}
</style>
