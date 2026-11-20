<script lang="ts">
	import { describeSchedule } from '$lib/describe';

	let { data } = $props();
</script>

<svelte:head><title>Habits · ittracks</title></svelte:head>

<header class="bar">
	<h1>Habits</h1>
	<a class="button primary" href="/habits/new">New habit</a>
</header>

{#if data.habits.length === 0}
	<p class="muted">
		A habit can be something to build, like a gym plan or language practice, or something to
		break, like smoking. Create your first one.
	</p>
{:else}
	<ul class="list">
		{#each data.habits as h (h.id)}
			<li>
				<a class="card" href="/habits/{h.id}">
					<strong>{h.name}</strong>
					<div class="muted" style="font-size: 0.9rem">
						{h.direction === 'break' ? 'Break habit' : describeSchedule(h.schedule)}
					</div>
				</a>
			</li>
		{/each}
	</ul>
{/if}
