<script lang="ts">
	import { describeSchedule } from '$lib/describe';

	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<svelte:head><title>Habits · ittracks</title></svelte:head>

<header class="bar">
	<h1>Habits</h1>
	<div class="row" style="align-items: center">
		<a href="/identities">Identities</a>
		<a class="button primary" href="/habits/new">New habit</a>
	</div>
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
						{h.direction === 'break' ? 'Break habit' : describeSchedule(h.schedule)}{h.cue?.time
							? ` · ${h.cue.time}`
							: ''}
					</div>
				</a>
			</li>
		{/each}
	</ul>
{/if}

<details class="card" style="margin-top: 1.5rem">
	<summary>Import a template</summary>
	<form method="POST" action="?/import" enctype="multipart/form-data" class="stack" style="margin-top: 0.75rem" use:enhance>
		<p class="muted" style="margin: 0">
			A template file (.ittracks.json) creates a habit, and adds the Tasks it uses to your Library as new Tasks.
		</p>
		<input type="file" name="file" accept=".json,application/json" required aria-label="Template file" />
		<button>Import</button>
	</form>
</details>
{#if form?.error}<p class="error">{form.error}</p>{/if}
{#if form?.imported}<p>Imported "{form.imported}" with {form.taskCount} {form.taskCount === 1 ? 'Task' : 'Tasks'}.</p>{/if}
