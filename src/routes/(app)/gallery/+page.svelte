<script lang="ts">
	import { CATEGORY_ORDER } from '$lib/gallery';

	let { data } = $props();

	let q = $state('');
	let category = $state('');
	let days = $state<'' | 'few' | 'most'>('');
	let minutes = $state<'' | '15' | '30' | '60'>('');
	let noEquipment = $state(false);

	const categories = $derived(
		[...new Set(data.items.map((i) => i.category))].sort(
			(a, b) => (CATEGORY_ORDER.indexOf(a) + 1 || 99) - (CATEGORY_ORDER.indexOf(b) + 1 || 99)
		)
	);
	type Item = (typeof data.items)[number];
	const matches = (i: Item) => {
		const text = q.trim().toLowerCase();
		return !text || `${i.name} ${i.description} ${i.category}`.toLowerCase().includes(text);
	};
	const yours = $derived(data.yours.filter(matches));
	const shown = $derived(
		data.items.filter((i) => {
			if (!matches(i)) return false;
			if (category && i.category !== category) return false;
			if (days === 'few' && !(i.daysPerWeek !== null && i.daysPerWeek <= 3)) return false;
			if (days === 'most' && !(i.daysPerWeek !== null && i.daysPerWeek >= 4)) return false;
			if (minutes && !(i.minutesPerDay !== null && i.minutesPerDay <= Number(minutes))) return false;
			if (noEquipment && i.equipment.length) return false;
			return true;
		})
	);
	const grouped = $derived(categories.map((c) => ({ c, items: shown.filter((i) => i.category === c) })).filter((g) => g.items.length));
	const toggle = (c: string) => (category = category === c ? '' : c);
</script>

<svelte:head><title>Gallery · ittracks</title></svelte:head>

<header class="bar">
	<h1>Gallery</h1>
	<a href="/habits">Habits</a>
</header>

<p class="muted">Ready-made habits with their Tasks. Pick one, answer a question or two, and change anything after.</p>

{#snippet card(i: Item)}
	<li>
		<a class="card item" href="/gallery/{i.slug}">
			<strong>{i.name}</strong>
			{#if i.description}<div class="muted small-text">{i.description}</div>{/if}
			<div class="chips">
				{#if i.inside}<span class="chip">{i.inside + 1} habits</span>{/if}
				{#if i.direction === 'break'}<span class="chip">Break a habit</span>{/if}
				{#if i.daysPerWeek}<span class="chip">{i.daysPerWeek === 7 ? 'Daily' : `${i.daysPerWeek} days a week`}</span>{/if}
				{#if i.minutesPerDay}<span class="chip">{i.minutesPerDay} min</span>{/if}
				{#each i.equipment as e (e)}<span class="chip">{e}</span>{/each}
			</div>
		</a>
	</li>
{/snippet}

<div class="stack">
	<input type="search" bind:value={q} placeholder="Search: running, reading, quit…" aria-label="Search the gallery" />
	<div class="chips">
		{#each categories as c (c)}
			<button type="button" class="chip" class:on={category === c} onclick={() => toggle(c)}>{c}</button>
		{/each}
	</div>
	<div class="row filters">
		<select bind:value={days} aria-label="Days per week">
			<option value="">Any days a week</option>
			<option value="few">3 days or fewer</option>
			<option value="most">4 days or more</option>
		</select>
		<select bind:value={minutes} aria-label="Time per day">
			<option value="">Any time a day</option>
			<option value="15">15 minutes or less</option>
			<option value="30">30 minutes or less</option>
			<option value="60">An hour or less</option>
		</select>
		<label style="color: var(--text)"><input type="checkbox" bind:checked={noEquipment} /> No equipment</label>
	</div>
</div>

{#if yours.length}
	<h2>Yours</h2>
	<ul class="list">
		{#each yours as i (i.slug)}{@render card(i)}{/each}
	</ul>
{/if}

{#each grouped as g (g.c)}
	<h2>{g.c}</h2>
	<ul class="list">
		{#each g.items as i (i.slug)}{@render card(i)}{/each}
	</ul>
{:else}
	<p class="muted">Nothing matches. Try fewer filters, or <a href="/habits/new" data-sveltekit-reload>create your own habit</a>.</p>
{/each}

<style>
	.list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.5rem;
	}
	.item {
		display: block;
		color: inherit;
		text-decoration: none;
	}
	.filters {
		flex-wrap: wrap;
		align-items: center;
	}
	.filters select {
		width: auto;
	}
	.small-text {
		font-size: 0.85rem;
	}
</style>
