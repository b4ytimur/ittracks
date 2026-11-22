<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	const shortDate = (d: string) =>
		new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
	const r = $derived(data.routine);
	/** The first habit still open: what to do next. */
	const next = $derived(data.kids.find((k) => k.status === 'due' || k.status === 'missed') ?? null);
	const open = (s: string) => s === 'due' || s === 'missed';
	const statusText = (s: string, level: string | null) =>
		s === 'done' ? (level === 'minimum' ? 'Done at Minimum' : level === 'stretch' ? 'Done at Stretch' : 'Done') : s === 'skipped' ? 'Skipped' : s === 'missed' ? 'Missed' : 'Due';
</script>

<svelte:head><title>{r.name}</title></svelte:head>

<div class="row head">
	<div class="grow">
		<h1>{r.name}</h1>
		<p class="muted small-text">
			{r.date === data.today ? 'Today' : shortDate(r.date)} · {statusText(r.status, r.level)}{#if r.count}&nbsp;· {r.count}{/if}
		</p>
	</div>
	<a href={r.date === data.today ? '/' : `/day/${r.date}`}>Back</a>
</div>

{#if next}
	<div class="card next">
		<span class="muted small-text">Next</span>
		<div class="row">
			<strong class="grow">{next.name}</strong>
			{#if next.hasTasks}
				<a class="button primary" href={next.log}>Log {next.name}</a>
			{:else}
				<form method="POST" action="?/done" use:enhance>
					<input type="hidden" name="occurrence" value={next.occurrenceId} />
					<button class="primary">Done</button>
				</form>
			{/if}
		</div>
	</div>
{/if}

<ol class="list">
	{#each data.kids as k (k.occurrenceId)}
		<li class="card" class:finished={!open(k.status)}>
			<div class="row">
				<div class="grow">
					<a class="name" href={k.log}><strong>{k.name}</strong></a>
					<div class="muted small-text">
						{statusText(k.status, k.level)}{#if k.progress && k.status !== 'skipped'}&nbsp;· {k.progress}{/if}
					</div>
				</div>
				{#if open(k.status)}
					{#if k.hasTasks}
						<a class="button" href={k.log} aria-label="Log {k.name}">Log</a>
					{:else}
						<form method="POST" action="?/done" use:enhance>
							<input type="hidden" name="occurrence" value={k.occurrenceId} />
							<button aria-label="Done: {k.name}">Done</button>
						</form>
					{/if}
					<form method="POST" action="?/skip" use:enhance>
						<input type="hidden" name="occurrence" value={k.occurrenceId} />
						<button aria-label="Skip {k.name}">Skip</button>
					</form>
				{:else}
					{#if k.hasTasks}<a class="button" href={k.log}>View</a>{/if}
					<form method="POST" action="?/undo" use:enhance>
						<input type="hidden" name="occurrence" value={k.occurrenceId} />
						<button class="link" aria-label="Undo {k.name}">Undo</button>
					</form>
				{/if}
			</div>
		</li>
	{/each}
</ol>

{#if form?.needsInput}
	<p class="warn small-text">Some habits need values filled in before they count. Open them to finish.</p>
{/if}

<div class="row actions">
	{#if open(r.status)}
		<form method="POST" action="?/done" use:enhance>
			<input type="hidden" name="occurrence" value={r.occurrenceId} />
			<button title="Every habit still open gets its one tap: its last log, or its targets">Mark the rest done</button>
		</form>
		<form method="POST" action="?/skip" use:enhance>
			<input type="hidden" name="occurrence" value={r.occurrenceId} />
			<button>Skip the rest</button>
		</form>
	{:else}
		<form method="POST" action="?/undo" use:enhance>
			<input type="hidden" name="occurrence" value={r.occurrenceId} />
			<button>Open {r.name} again</button>
		</form>
	{/if}
</div>
<p class="muted small-text">Each habit keeps its own log and streak. {r.name}'s day counts them.</p>

<style>
	.head {
		align-items: flex-start;
	}
	h1 {
		margin-bottom: 0.15rem;
	}
	.next {
		margin-bottom: 1rem;
		border-color: var(--accent);
	}
	ol.list {
		padding: 0;
		list-style: none;
	}
	.finished {
		opacity: 0.6;
	}
	.actions {
		margin: 1rem 0 0.5rem;
		flex-wrap: wrap;
	}
	.warn {
		color: var(--warn, #b45309);
	}
</style>
