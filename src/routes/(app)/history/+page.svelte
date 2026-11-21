<script lang="ts">
	import { untrack } from 'svelte';
	import ViewBar from '$lib/ViewBar.svelte';
	import { STATUSES } from '$lib/views';
	import { viewOp } from '$lib/viewclient';

	let { data } = $props();

	let views = $state(untrack(() => data.views));
	let view = $state(untrack(() => data.initial));

	const label = (d: string) =>
		new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
	const statusWord: Record<string, string> = { done: 'Done', skipped: 'Skipped', missed: 'Missed' };

	const fits = (x: { habitId: string; areaId: string | null }) =>
		(!view.habit || x.habitId === view.habit) && (!view.areas.length || view.areas.includes(x.areaId ?? ''));
	/** Days with only what passes the filters; empty days drop out. */
	const days = $derived.by(() => {
		const out = data.history
			.map(([date, day]) => {
				const occurrences = view.status === 'slip' ? [] : day.occurrences.filter((o) => fits(o) && (view.status === 'all' || o.status === view.status));
				const slips = view.status === 'all' || view.status === 'slip' ? day.slips.filter(fits) : [];
				return { date, occurrences, slips };
			})
			.filter((d) => d.occurrences.length || d.slips.length);
		return view.sort === 'oldest' ? out.reverse() : out;
	});

	function toggleValues() {
		views.history = { ...views.history, values: !views.history.values };
		viewOp({ op: 'patch', history: { values: views.history.values } });
	}
</script>

<svelte:head><title>History · ittracks</title></svelte:head>

<header class="bar">
	<h1>History</h1>
	<div class="row" style="align-items: center">
		{#if data.canBackfill}<a class="button small" href="/day">Log a past day</a>{/if}
		<a href="/settings">Settings</a>
	</div>
</header>

{#if data.history.length}
	<ViewBar page="history" bind:views bind:current={view} areas={data.areas} habits={data.habits} statuses={STATUSES} />
	<label class="values"><input type="checkbox" checked={views.history.values} onchange={toggleValues} /> Show logged values (like "80 kg × 8")</label>
{/if}

{#if data.history.length === 0}
	<p class="muted">Nothing logged in the last {data.days} days yet.</p>
{:else if days.length === 0}
	<p class="muted">Nothing in the last {data.days} days matches these filters.</p>
{/if}

{#each days as day (day.date)}
	<h2 class="dayhead">
		{label(day.date)}
		{#if data.canBackfill && day.date < data.today}<a class="small-text" href="/day/{day.date}" aria-label="Log or change {label(day.date)}">Log this day</a>{/if}
	</h2>
	<ul class="list">
		{#each day.occurrences as o (o.id)}
			<li>
				<a class="card" href="/log/{o.id}">
					<div class="row">
						<span class="grow"
							><strong>{o.habit}</strong>{#if o.variant}<span class="chip" style="margin-left: 0.35rem">{o.variant}</span>{/if}</span
						>
						<span class="muted" class:missed={o.status === 'missed'}>
							{statusWord[o.status]}{!views.history.values && data.entryCounts[o.id] ? ` · ${data.entryCounts[o.id]} entries` : ''}
						</span>
					</div>
					{#if views.history.values}
						{#each data.values[o.id] ?? [] as line (line)}<div class="muted small-text">{line}</div>{/each}
					{/if}
				</a>
			</li>
		{/each}
		{#each day.slips as s, i (i)}
			<li class="card row">
				<span class="grow"><strong>{s.habit}</strong></span>
				<span class="muted">Slip{s.count !== 1 ? ` × ${s.count}` : ''}</span>
			</li>
		{/each}
	</ul>
{/each}

{#if data.history.length}
	<p style="margin-top: 1.5rem"><a href="?days={data.days * 4}">Show older</a></p>
{/if}

<style>
	.missed {
		color: var(--danger);
	}
	.small-text {
		font-size: 0.85rem;
	}
	.dayhead {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
	}
	.dayhead a {
		font-weight: 400;
	}
	.values {
		color: var(--text);
		font-size: 0.85rem;
	}
</style>
