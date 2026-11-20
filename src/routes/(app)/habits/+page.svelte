<script lang="ts">
	import { describeSchedule } from '$lib/describe';
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const area = (id: string | null) => data.areas.find((a) => a.id === id);
	const groups = $derived.by(() => {
		if (!data.groupByArea) return [{ key: 'all', area: null as (typeof data.areas)[number] | null, items: data.habits }];
		return [...data.areas.map((a) => a.id), '']
			.map((k) => ({
				key: k || 'none',
				area: area(k) ?? null,
				items: data.habits.filter((h) => (h.areaId && area(h.areaId) ? h.areaId : '') === k)
			}))
			.filter((g) => g.items.length);
	});
	const cueText = (c: { time: string | null; range?: string | null } | null) => c?.time ?? c?.range ?? null;
</script>

<svelte:head><title>Habits · ittracks</title></svelte:head>

<header class="bar">
	<h1>Habits</h1>
	<div class="row" style="align-items: center">
		<a href="/identities">Identities</a>
		<a href="/gallery">Gallery</a>
		<a class="button primary" href="/habits/new" data-sveltekit-reload>New habit</a>
	</div>
</header>

{#if data.added}<p class="card added">Added "{data.added}". It's on Today when it's due.</p>{/if}

{#if data.habits.length === 0}
	<p class="muted">
		A habit can be something to build, like a gym plan or language practice, or something to
		break, like smoking. <a href="/gallery">Pick a ready-made one</a> or <a href="/habits/new" data-sveltekit-reload>create your own</a>.
	</p>
{/if}

{#each groups as g (g.key)}
	{#if data.groupByArea}
		<h2 class="area" style="--c: {g.area?.color ?? 'var(--border)'}">{g.area ? `${g.area.icon} ${g.area.name}` : 'No area'}</h2>
	{/if}
	<ul class="list">
		{#each g.items as h (h.id)}
			{@const a = area(h.areaId)}
			<li>
				<a class="card habit" href="/habits/{h.id}" data-sveltekit-reload style="--c: {a?.color ?? 'transparent'}">
					<strong>{h.name}</strong>
					{#if h.archived}<span class="chip">Archived</span>{/if}
					<div class="muted" style="font-size: 0.9rem">
						{h.direction === 'break' ? 'Break habit' : describeSchedule(h.schedule)}{cueText(h.cue) ? ` · ${cueText(h.cue)}` : ''}{a && !data.groupByArea ? ` · ${a.icon} ${a.name}` : ''}
					</div>
				</a>
			</li>
		{/each}
	</ul>
{/each}

<p class="small-text"><a href={data.showArchived ? '/habits' : '/habits?archived'}>{data.showArchived ? 'Hide archived habits' : 'Show archived habits'}</a></p>

<details class="card" style="margin-top: 1rem">
	<summary>Import a template file</summary>
	<form method="POST" action="?/import" enctype="multipart/form-data" class="stack" style="margin-top: 0.75rem" use:enhance>
		<input type="file" name="file" accept=".json,application/json" required />
		<label style="color: var(--text)"><input type="checkbox" name="separate" /> Make new Tasks even if the Library has ones with the same name</label>
		<button>Import</button>
	</form>
</details>
{#if form?.error}<p class="error">{form.error}</p>{/if}
{#if form?.imported}
	<p>Imported "{form.imported}"{form.taskCount ? ` with ${form.taskCount} new Tasks` : ''}{form.reused ? `, reusing ${form.reused} from your Library` : ''}.</p>
{/if}

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
		margin-top: 1rem;
	}
	.chip {
		margin-left: 0.35rem;
	}
</style>
