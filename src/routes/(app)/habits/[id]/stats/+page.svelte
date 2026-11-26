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
		add={{ label: 'New card', onclick: () => (adding = true) }}
		addHidden={adding}
		onreset={() => op({ op: 'habit.reset', habit: data.habit.id }, 'Back to the automatic cards')}
		resetLabel="Back to the automatic cards"
		atDefault={!data.customized}
	/>
	<RecordTabs habit={data.habit.id} at="stats" />

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
	.foot {
		margin-top: var(--space-section);
		text-align: center;
	}
</style>
