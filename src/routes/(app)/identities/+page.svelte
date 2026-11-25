<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { runAction, showToast } from '$lib/toast.svelte';

	let { data, form } = $props();
	let editing = $state<string | null>(null);
	async function remove(i: { id: string; statement: string }) {
		const r = await runAction<{ deleted: object }>('?/delete', { id: i.id });
		if (!r.ok || !r.data) return void showToast(r.error ?? 'Not deleted. Are you online?');
		const deleted = JSON.stringify(r.data.deleted);
		await invalidateAll();
		showToast(`Deleted “${i.statement}”. Its habits stay.`, async () => void (await runAction('?/restore', { deleted })));
	}
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
</script>

<svelte:head><title>Identities · ittracks</title></svelte:head>

<header class="bar">
	<h1>Identities</h1>
	<a href="/">Back</a>
</header>

<p class="muted">
	Who do you want to become? Link habits to an identity in the habit editor. Every time you do one of
	them, or resist a craving on a break habit, it's a vote for that identity.
</p>

{#if data.identities.length}
	<ul class="list">
		{#each data.identities as i (i.id)}
			<li class="card">
				{#if editing === i.id}
					<form
						method="POST"
						action="?/rename"
						class="row"
						use:enhance={() =>
							async ({ update }) => {
								editing = null;
								await update();
							}}
					>
						<input type="hidden" name="id" value={i.id} />
						<input class="grow" name="statement" value={i.statement} aria-label="Identity" required />
						<button class="primary">Save</button>
						<button type="button" onclick={() => (editing = null)}>Cancel</button>
					</form>
				{:else}
					<div class="row">
						<strong class="grow">{i.statement}</strong>
						<button class="small" onclick={() => (editing = i.id)}>Edit</button>
						<button type="button" class="small danger" onclick={() => remove(i)}>Delete</button>
					</div>
				{/if}
				<div class="votes">
					<span class="big">{i.week}</span>
					<span class="muted">{i.week === 1 ? 'vote' : 'votes'} this week · {plural(i.total, 'vote')} in all</span>
				</div>
				{#if i.habits.length}
					<div class="chips">
						{#each i.habits as h (h.id)}<a class="chip" href="/habits/{h.id}">{h.name}</a>{/each}
					</div>
				{:else}
					<p class="muted small-text">No habits linked yet.</p>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<form method="POST" action="?/add" class="row" style="margin-top: 1rem" use:enhance>
	<label class="grow">New identity <input name="statement" placeholder="I am someone who speaks Spanish" required /></label>
	<button class="primary">Add</button>
</form>
{#if form?.error}<p class="error">{form.error}</p>{/if}

<style>
	.votes {
		margin-top: 0.5rem;
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}
	.big {
		font-size: 1.6rem;
		font-weight: 600;
	}
	.small-text {
		font-size: 0.85rem;
	}
	a.chip {
		text-decoration: none;
	}
</style>
