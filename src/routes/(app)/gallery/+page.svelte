<script lang="ts">
	import { CATEGORY_ORDER, WANTS } from '$lib/gallery/wants';
	import { addFrom } from '$lib/say/add';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import GroupHeading from '$lib/ui/GroupHeading.svelte';

	let { data } = $props();

	let q = $state('');
	let days = $state<'' | 'few' | 'most'>('');
	let minutes = $state<'' | '15' | '30' | '60'>('');
	let noEquipment = $state(false);
	let problem = $state('');
	let busy = $state('');

	type Item = (typeof data.items)[number];
	const want = (c: string) => WANTS[c] ?? c;
	const matches = (i: Item) => {
		const text = q.trim().toLowerCase();
		return !text || text.split(/\s+/).every((w) => `${i.name} ${i.description} ${i.category} ${want(i.category)}`.toLowerCase().includes(w));
	};
	const yours = $derived(data.yours.filter(matches));
	const shown = $derived(
		data.items.filter(
			(i) =>
				matches(i) &&
				(days !== 'few' || (i.daysPerWeek !== null && i.daysPerWeek <= 3)) &&
				(days !== 'most' || (i.daysPerWeek !== null && i.daysPerWeek >= 4)) &&
				(!minutes || (i.minutesPerDay !== null && i.minutesPerDay <= Number(minutes))) &&
				(!noEquipment || !i.equipment.length)
		)
	);
	const categories = $derived([...new Set(shown.map((i) => i.category))].sort((a, b) => (CATEGORY_ORDER.indexOf(a) + 1 || 99) - (CATEGORY_ORDER.indexOf(b) + 1 || 99)));
	const groups = $derived([...(yours.length ? [{ title: 'Yours', items: yours }] : []), ...categories.map((c) => ({ title: want(c), items: shown.filter((i) => i.category === c) }))]);
	const filtered = $derived(!!(q.trim() || days || minutes || noEquipment));
	const clear = () => {
		q = '';
		days = minutes = '';
		noEquipment = false;
	};
	const facts = (i: Item) => [i.inside ? `${i.inside + 1} habits` : '', i.direction === 'break' ? 'to stop' : '', i.daysPerWeek ? (i.daysPerWeek === 7 ? 'daily' : `${i.daysPerWeek} days a week`) : '', i.minutesPerDay ? `${i.minutesPerDay} min` : '', i.equipment.join(', ')].filter(Boolean).join(' · ');
	/** As it comes: its questions keep their defaults. */
	async function add(i: Item) {
		if (busy) return;
		busy = i.slug;
		const body = new FormData();
		body.set('plain', 'on');
		body.set('addAreas', 'on');
		problem = await addFrom(`/gallery/${i.slug}?/add`, body, '/gallery');
		busy = '';
	}
</script>

<svelte:head><title>Gallery · ittracks</title></svelte:head>

<EditChrome title="Gallery" modes={['use']} back={{ href: '/habits', label: 'Habits' }} hints={{ use: 'Ready-made habits. Add one as it comes, or open it to change its words first.' }} />

<div class="search" role="search">
	<label class="vh" for="gallery-q">Search the Gallery</label>
	<input id="gallery-q" type="search" bind:value={q} placeholder="Search: running, reading, quit…" autocomplete="off" />
	{#if q}<button type="button" class="quiet glyph search-clear focus-inset" aria-label="Clear search" onclick={() => (q = '')}>×</button>{/if}
</div>
<div class="l-cluster filters">
	<select bind:value={days} aria-label="Days per week"><option value="">Any days</option><option value="few">3 days or fewer</option><option value="most">4 days or more</option></select>
	<select bind:value={minutes} aria-label="Time per day"><option value="">Any time</option><option value="15">15 min or less</option><option value="30">30 min or less</option><option value="60">An hour or less</option></select>
	<label class="check"><input type="checkbox" class="pick" bind:checked={noEquipment} /> Nothing needed</label>
</div>
{#if problem}<p class="error" role="alert">{problem}</p>{/if}

{#each groups as g (g.title)}
	<section class="ob-sec" aria-label={g.title}>
		<GroupHeading title={g.title} count={String(g.items.length)} />
		<ul class="elist" style="--gap: var(--space-inline)">
			{#each g.items as i (i.slug)}
				<li class="row">
					<div class="card link">
						<div class="content">
							<a class="name" href="/gallery/{i.slug}">{i.name}</a>
							<p class="meta-line meta muted">{facts(i) || i.description}</p>
						</div>
						<span class="verb"><button type="button" class="quiet" aria-label="Add {i.name}" aria-disabled={!!busy} onclick={() => add(i)}>{busy === i.slug ? 'Adding…' : 'Add'}</button></span>
					</div>
				</li>
			{/each}
		</ul>
	</section>
{:else}
	<EmptyState kind="filtered" text="Nothing matches." onclear={filtered ? clear : undefined} />
{/each}

<style>
	.filters {
		margin-block: var(--space-inline) var(--space-group);
	}
	.filters select {
		width: auto;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	/* The row opens the template; its Add stays above that. */
	.card.link .verb {
		position: relative;
		z-index: var(--z-raised);
	}
</style>
