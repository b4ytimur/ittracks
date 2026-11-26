<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { showToast } from '$lib/toast.svelte';
	import { statsOp } from '$lib/stats/client';
	import type { StatCard } from '$lib/stats/model';
	import CardGrid from '$lib/stats/ui/CardGrid.svelte';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import RecordTabs from '$lib/detail/RecordTabs.svelte';

	let { data } = $props();
	/** Edit mode is a flag on this same page: the grid shows handles, sizes and Edit on each card. */
	let editing = $state(false);
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

<div class="stats-page page-wide">
	<EditChrome
		title={data.habit.name}
		back={{ href: '/habits', label: 'Habits' }}
		mode={editing ? 'edit' : 'use'}
		modes={['use', 'edit']}
		hints={{ use: data.customized ? 'Your own cards' : 'Made from what it logs', edit: 'Drag a card to move it.' }}
		onmode={(m) => ((editing = m === 'edit'), (adding = false))}
	/>
	<RecordTabs habit={data.habit.id} at="stats" />

	{#if editing}
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
		{editing}
		bind:adding
		csv={(id) => `/stats/export?habit=${data.habit.id}&card=${id}`}
		headlines={data.headline ? [data.headline] : []}
		onheadline={headline}
	/>
	{#if !data.customized}
		<p class="muted meta foot">These cards are made from what {data.habit.name} logs. Customize to change them.</p>
	{/if}
</div>

<style>
	.tools {
		margin-bottom: 0.75rem;
	}
	.foot {
		margin-top: 1.5rem;
		text-align: center;
	}
</style>
