<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { showToast } from '$lib/toast.svelte';
	import { statsOp } from '$lib/stats/client';
	import type { StatCard } from '$lib/stats/model';
	import CardGrid from '$lib/stats/ui/CardGrid.svelte';

	let { data } = $props();
	let customizing = $state(false);
	let adding = $state(false);

	async function op(body: Record<string, unknown>, done: string) {
		try {
			await statsOp(body);
			await invalidateAll();
			showToast(done);
		} catch (e) {
			showToast((e as Error).message);
		}
	}
	const headline = (card: StatCard) =>
		data.headline === card.id
			? op({ op: 'headline', habit: data.habit.id, card: null }, 'Today shows the usual headline again')
			: op({ op: 'headline', habit: data.habit.id, card }, `Today shows “${card.title}” for ${data.habit.name}`);
</script>

<svelte:head><title>{data.habit.name} stats · ittracks</title></svelte:head>

<div class="stats-page">
	<header class="bar">
		<div>
			<h1>{data.habit.name}</h1>
			<div class="muted">Stats{data.customized ? ' · customized' : ''}</div>
		</div>
		<div class="row" style="align-items: center">
			<a href="/habits/{data.habit.id}/chain">Chain</a>
			<a href="/habits/{data.habit.id}">Edit</a>
			<button type="button" class:primary={customizing} onclick={() => ((customizing = !customizing), (adding = false))}>{customizing ? 'Done' : 'Customize'}</button>
		</div>
	</header>

	{#if customizing}
		<div class="row tools">
			<button type="button" class="primary" onclick={() => (adding = true)}>Add a card</button>
			{#if data.customized}
				<button type="button" onclick={() => op({ op: 'habit.reset', habit: data.habit.id }, 'Back to the automatic cards')}>Back to the automatic cards</button>
			{/if}
		</div>
	{/if}

	<CardGrid
		items={data.items}
		where={{ habit: data.habit.id }}
		board={{ range: '30d', filter: { areas: [], tags: [], habit: data.habit.id, identity: null, direction: 'all' } }}
		catalog={data.catalog}
		measures={data.measures}
		hidden={data.hidden}
		suggested={data.suggested}
		gallery={data.gallery}
		{customizing}
		bind:adding
		csv={(id) => `/stats/export?habit=${data.habit.id}&card=${id}`}
		headlines={data.headline ? [data.headline] : []}
		onheadline={headline}
	/>
	{#if !data.customized}
		<p class="muted small foot">These cards are made from what {data.habit.name} logs. Customize to change them.</p>
	{/if}
</div>

<style>
	:global(.content:has(.stats-page)) {
		max-width: 1080px;
	}
	.tools {
		margin-bottom: 0.75rem;
	}
	.small {
		font-size: 0.8rem;
	}
	.foot {
		margin-top: 1.5rem;
		text-align: center;
	}
</style>
