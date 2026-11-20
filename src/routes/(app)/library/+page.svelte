<script lang="ts">
	let { data } = $props();
	let filter = $state<string | null>(null);

	const levelWord = ['', 'low', 'medium', 'high'];
	const shown = $derived(
		filter ? data.tasks.filter((t) => t.tags.some((g) => g.name === filter)) : data.tasks
	);
</script>

<svelte:head><title>Library · ittracks</title></svelte:head>

<header class="bar">
	<h1>Library</h1>
	<a class="button primary" href="/library/new">New task</a>
</header>

{#if data.tags.length}
	<div class="chips" role="group" aria-label="Filter by tag">
		<button class="chip small" class:on={filter === null} onclick={() => (filter = null)}>All</button>
		{#each data.tags as t (t)}
			<button class="chip small" class:on={filter === t} onclick={() => (filter = filter === t ? null : t)}>{t}</button>
		{/each}
	</div>
{/if}

{#if data.tasks.length === 0}
	<p class="muted">
		Your Library holds the Tasks you build habits from, like "Bench press" or "Learn new words".
		Add your first one.
	</p>
{:else}
	<ul class="list" style="margin-top: 1rem">
		{#each shown as t (t.id)}
			<li>
				<a class="card" href="/library/{t.id}">
					<strong>{t.name}</strong>
					{#if t.tags.length}
						<div class="chips">
							{#each t.tags as g (g.name)}<span class="chip">{g.name}: {levelWord[g.level]}</span>{/each}
						</div>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
{/if}
