<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { showToast } from '$lib/toast.svelte';
	import { statsOp, undoOp } from '$lib/stats/client';
	import { headlineChange, tabMore } from '$lib/stats/habit-tab';
	import { keepFocus } from '$lib/ui/focus';
	import type { StatCard } from '$lib/stats/model';
	import CardGrid from '$lib/stats/ui/CardGrid.svelte';
	import TitleLine from '$lib/ui/TitleLine.svelte';
	import RecordTabs from '$lib/detail/RecordTabs.svelte';

	let { data } = $props();
	// No Edit: a card's words, chart and size change where they stand and its grip moves it, as on a board.
	let adding = $state(false);

	async function op(body: Record<string, unknown>, done: string, undo: () => unknown) {
		try {
			await statsOp(body);
			await invalidateAll();
			showToast(done, undo);
		} catch (e) {
			showToast((e as Error).message);
		}
	}
	/** Back to the automatic cards; its Undo puts these cards, and the number Today showed from one, back. */
	async function reset() {
		const back = { op: 'habit.restore', habit: data.habit.id, cards: data.items.map((i) => i.card), headline: data.headline };
		await op({ op: 'habit.reset', habit: data.habit.id }, 'Back to the automatic cards', undoOp(back));
		// The ⋯ goes with the cards of its own: focus that fell to the page goes to New card beside it.
		void keepFocus('.titlebar [data-add]');
	}
	function headline(card: StatCard, title: string) {
		const h = headlineChange(data.habit, data.headline, card, title);
		op(h.change, h.said, undoOp(h.undo));
	}
</script>

<svelte:head><title>{data.habit.name} stats · ittracks</title></svelte:head>

<div class="stats-page page-wide">
	<TitleLine
		title={data.habit.name}
		back={{ href: '/habits', label: 'Habits' }}
		hint={data.customized ? 'Your own cards' : 'Made from what it logs'}
		add={{ label: 'New card', onclick: () => (adding = true) }}
		addHidden={adding}
		more={tabMore(data.customized, reset)}
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
		bind:adding
		csv={(id) => `/stats/export?habit=${data.habit.id}&card=${id}`}
		headlines={data.headline ? [data.headline.id] : []}
		onheadline={headline}
	/>
	{#if !data.customized}
		<p class="muted meta foot">These cards are made from what {data.habit.name} logs. Change one in its words or its ⋯, or move one by its ⠿, to make them your own.</p>
	{/if}
</div>

<style>
	.foot {
		margin-top: var(--space-section);
		text-align: center;
	}
</style>
