<script lang="ts">
	import { untrack } from 'svelte';
	import { PAGES, PAGE_LABEL, type Page } from '$lib/views';
	import { checkViews } from '$lib/rules/views';
	import { viewOp } from '$lib/viewclient';
	import { showToast } from '$lib/toast.svelte';

	let { data } = $props();

	let views = $state(untrack(() => data.views));
	const current = $derived(data.templates.find((t) => t.id === views.template));
	/** What the view rules say about the views as they are now. */
	const issues = $derived(checkViews(views, { ranges: data.ranges }));

	async function useTemplate(id: string, reset = false) {
		const t = data.templates.find((x) => x.id === id);
		const r = await viewOp({ op: 'template', id });
		if (!r) return showToast("Couldn't switch. Are you online?");
		const before = r.previous;
		views = r.views;
		showToast(reset ? `Reset to ${t?.name}.` : `Switched to ${t?.name}.`, async () => {
			const back = await viewOp({ op: 'restore', views: before });
			if (back) views = back.views;
		});
	}
	async function setStartPage(startPage: Page) {
		const r = await viewOp({ op: 'patch', startPage });
		if (r) views = r.views;
		else showToast("Couldn't save. Are you online?");
	}
</script>

<svelte:head><title>Views · Settings · ittracks</title></svelte:head>

<header class="bar">
	<h1>Views</h1>
	<a href="/settings">‹ Settings</a>
</header>

{#if issues.length}
	<section class="card stack" role="status">
		<h2 style="margin: 0">To check</h2>
		<ul class="issues">
			{#each issues as i (i.reason)}<li class={i.severity === 'block' ? 'error' : ''}>{i.reason}</li>{/each}
		</ul>
	</section>
{/if}

<section class="card stack">
	<h2 style="margin: 0">Start page</h2>
	<label
		>Open the app on
		<select value={views.startPage} onchange={(e) => setStartPage(e.currentTarget.value as Page)}>
			{#each PAGES as p (p)}<option value={p}>{PAGE_LABEL[p]}</option>{/each}
		</select>
	</label>
	<p class="muted small-text" style="margin: 0">Used when you open the app from its icon, a bookmark or the address bar.</p>
</section>

<section class="card stack">
	<h2 style="margin: 0">View template</h2>
	<p class="muted small-text" style="margin: 0">
		A view template sets what each page shows. You can still change anything afterwards with Customize on each page.
		Your saved views and own order are kept when you switch.
	</p>
	<p style="margin: 0">Now: <strong>{current?.name ?? 'Custom'}</strong></p>
	<ul class="list">
		{#each data.templates as t (t.id)}
			<li class="card row tpl">
				<div class="grow">
					<strong>{t.name}</strong>
					<div class="muted small-text">{t.blurb}</div>
					<div class="muted small-text">{t.summary}</div>
				</div>
				{#if t.id === views.template}
					<button class="small" onclick={() => useTemplate(t.id, true)} title="Undo your own changes to this template">Reset</button>
				{:else}
					<button class="small" onclick={() => useTemplate(t.id)}>Use</button>
				{/if}
			</li>
		{/each}
	</ul>
	<p class="muted small-text" style="margin: 0">To switch whole features off, go to <a href="/settings/features">Features</a>.</p>
</section>

<style>
	.tpl {
		align-items: center;
	}
	.small-text {
		font-size: 0.85rem;
	}
	.issues {
		margin: 0;
		padding-left: 1.2rem;
	}
</style>
