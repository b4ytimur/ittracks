<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let slipOpen = $state<string | null>(null);

	const dateLabel = $derived(
		new Date(data.today + 'T12:00:00').toLocaleDateString(undefined, {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		})
	);
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
</script>

<svelte:head><title>Today · ittracks</title></svelte:head>

<header class="bar">
	<div>
		<h1>Today</h1>
		<div class="muted">{dateLabel}</div>
	</div>
</header>

{#if !data.build.length && !data.resting.length && !data.breaking.length}
	<p class="muted">Nothing here yet. <a href="/habits/new">Create a habit</a> to get started.</p>
{/if}

{#if data.build.length}
	<ul class="list">
		{#each data.build as item (item.habitId)}
			{@const o = item.occurrence!}
			<li class="card" class:finished={o.status !== 'due'}>
				<div class="row">
					<div class="grow">
						<strong>{item.name}</strong>
						{#if item.multiVariant && o.variantName}<span class="chip">{o.variantName}</span>{/if}
						<div class="muted small-text">
							{#if o.status === 'done'}Done{:else if o.status === 'skipped'}Skipped{:else}Due{/if}
							{#if item.streak > 0}· streak {item.streak}{/if}
						</div>
					</div>
					{#if o.status === 'due'}
						{#if o.slotCount > 0}
							<a class="button primary" href="/log/{o.id}">Start</a>
						{:else}
							<form method="POST" action="?/done" use:enhance>
								<input type="hidden" name="occurrence" value={o.id} />
								<button class="primary">Done</button>
							</form>
						{/if}
						<form method="POST" action="?/skip" use:enhance>
							<input type="hidden" name="occurrence" value={o.id} />
							<button>Skip</button>
						</form>
					{:else}
						{#if o.slotCount > 0}<a class="button" href="/log/{o.id}">View</a>{/if}
						<form method="POST" action="?/undo" use:enhance>
							<input type="hidden" name="occurrence" value={o.id} />
							<button class="link">Undo</button>
						</form>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{/if}

{#if data.breaking.length}
	<h2>Breaking</h2>
	<ul class="list">
		{#each data.breaking as b (b.habitId)}
			<li class="card">
				<div class="row">
					<div class="grow">
						<strong>{b.name}</strong>
						<div class="big">{plural(b.days, 'day')}</div>
						<div class="muted small-text">
							Longest run {plural(b.longest, 'day')}{b.slippedToday ? ` · ${b.slippedToday} today` : ''}
						</div>
					</div>
					<button onclick={() => (slipOpen = slipOpen === b.habitId ? null : b.habitId)}>Slip</button>
				</div>
				{#if slipOpen === b.habitId}
					<form
						method="POST"
						action="?/slip"
						class="row"
						style="margin-top: 0.75rem"
						use:enhance={() =>
							async ({ update }) => {
								slipOpen = null;
								await update();
							}}
					>
						<input type="hidden" name="habit" value={b.habitId} />
						<label style="width: 5rem">Count <input name="count" type="number" min="1" step="1" value="1" /></label>
						<label class="grow">Date <input name="date" type="date" value={data.today} max={data.today} /></label>
						<button class="primary">Log slip</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if data.resting.length}
	<h2>Not due today</h2>
	<ul class="list">
		{#each data.resting as item (item.habitId)}
			<li class="card row">
				<div class="grow">
					<strong>{item.name}</strong>
					{#if item.streak > 0}<div class="muted small-text">streak {item.streak}</div>{/if}
				</div>
				{#if item.earlyVariant}
					<form method="POST" action="?/early" use:enhance>
						<input type="hidden" name="habit" value={item.habitId} />
						<input type="hidden" name="variant" value={item.earlyVariant.id} />
						<button class="small">Start {item.multiVariant ? item.earlyVariant.name : ''} early</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if form?.error}<p class="error">{form.error}</p>{/if}

<style>
	.finished {
		opacity: 0.7;
	}
	.small-text {
		font-size: 0.85rem;
	}
	.big {
		font-size: 1.6rem;
		font-weight: 600;
	}
	.chip {
		margin-left: 0.35rem;
	}
</style>
