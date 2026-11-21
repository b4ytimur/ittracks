<script lang="ts">
	import { untrack } from 'svelte';
	import { PAGES, PAGE_LABEL, ownChanges, type Page } from '$lib/views';
	import { checkViews } from '$lib/rules/views';
	import { viewOp } from '$lib/viewclient';
	import { showToast } from '$lib/toast.svelte';

	let { data } = $props();

	let views = $state(untrack(() => data.views));
	const current = $derived(data.templates.find((t) => t.id === views.template));
	/** What the view rules say about the views as they are now. */
	const issues = $derived(checkViews(views, { ranges: data.ranges }));

	/** Settings you changed on top of the template, kept when you switch unless you say otherwise. */
	const mine = $derived(ownChanges(views));
	/** The template being switched to, waiting for "Switch" so you can see what happens first. */
	let asking = $state<string | null>(null);
	let keep = $state(true);

	function ask(id: string) {
		asking = id;
		keep = true;
	}

	async function useTemplate(id: string, reset = false) {
		const t = data.templates.find((x) => x.id === id);
		const kept = !reset && keep && mine.length > 0;
		const r = await viewOp({ op: 'template', id, keep: kept });
		if (!r) return showToast("Couldn't switch. Are you online?");
		asking = null;
		const before = r.previous;
		views = r.views;
		showToast(reset ? `Reset to ${t?.name}.` : `Switched to ${t?.name}${kept ? ', your own changes kept' : ''}.`, async () => {
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
		Your saved views, own order, start page and what each page opens with are always kept when you switch.
	</p>
	<p style="margin: 0">
		Now: <strong>{current?.name ?? 'Custom'}</strong>{#if mine.length}, with {mine.length === 1 ? 'one change' : `${mine.length} changes`} of your own{/if}
	</p>
	{#if mine.length}
		<details>
			<summary class="small-text">Your own changes</summary>
			<ul class="issues small-text">
				{#each mine as c (c.key)}<li>{c.label}</li>{/each}
			</ul>
		</details>
	{/if}
	<ul class="list">
		{#each data.templates as t (t.id)}
			<li class="card row tpl">
				<div class="grow">
					<strong>{t.name}</strong>
					<div class="muted small-text">{t.blurb}</div>
					<div class="muted small-text">{t.summary}</div>
				</div>
				{#if t.id === views.template}
					<button
						class="small"
						disabled={!mine.length}
						onclick={() => useTemplate(t.id, true)}
						title={mine.length ? 'Drop your own changes and go back to this template as it comes' : 'Nothing changed on top of this template'}
						>Reset</button
					>
				{:else if asking !== t.id}
					<button class="small" onclick={() => ask(t.id)}>Use</button>
				{/if}
			</li>
			{#if asking === t.id}
				<li class="card stack confirm" role="group" aria-label="Switch to {t.name}">
					<strong>Switch to {t.name}?</strong>
					{#if mine.length}
						<label style="color: var(--text)"
							><input type="checkbox" bind:checked={keep} /> Keep my own changes ({mine.map((c) => c.label.toLowerCase()).join(', ')})</label
						>
						<p class="muted small-text" style="margin: 0">
							{keep
								? `${t.name} changes everything else. Your own changes stay as they are.`
								: `${t.name} replaces your own changes too.`}
						</p>
					{:else}
						<p class="muted small-text" style="margin: 0">You haven't changed anything on top of {current?.name ?? 'your template'}, so nothing of yours is lost.</p>
					{/if}
					<div class="row">
						<button class="small primary" onclick={() => useTemplate(t.id)}>Switch</button>
						<button class="small" onclick={() => (asking = null)}>Cancel</button>
					</div>
				</li>
			{/if}
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
	.confirm {
		border-color: var(--accent);
	}
</style>
