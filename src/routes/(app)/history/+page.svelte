<script lang="ts">
	let { data } = $props();

	const label = (d: string) =>
		new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
	const statusWord: Record<string, string> = { done: 'Done', skipped: 'Skipped', missed: 'Missed' };
</script>

<svelte:head><title>History · ittracks</title></svelte:head>

<header class="bar">
	<h1>History</h1>
	<a href="/settings">Settings</a>
</header>

{#if data.history.length === 0}
	<p class="muted">Nothing logged in the last {data.days} days yet.</p>
{/if}

{#each data.history as [date, day] (date)}
	<h2>{label(date)}</h2>
	<ul class="list">
		{#each day.occurrences as o (o.id)}
			<li>
				<a class="card row" href="/log/{o.id}">
					<span class="grow"
						><strong>{o.habit}</strong>{#if o.variant}<span class="chip" style="margin-left: 0.35rem">{o.variant}</span>{/if}</span
					>
					<span class="muted" class:missed={o.status === 'missed'}>
						{statusWord[o.status]}{data.entryCounts[o.id] ? ` · ${data.entryCounts[o.id]} entries` : ''}
					</span>
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
</style>
