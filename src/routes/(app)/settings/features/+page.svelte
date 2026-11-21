<script lang="ts">
	import { untrack } from 'svelte';
	import { FEATURES, type FeatureKey } from '$lib/views';
	import { checkViews } from '$lib/rules/views';
	import { viewOp } from '$lib/viewclient';
	import { showToast } from '$lib/toast.svelte';

	let { data } = $props();

	let views = $state(untrack(() => data.views));

	/** View rule warnings that only come up because a feature is switched off. */
	const issues = $derived.by(() => {
		const ctx = { ranges: data.ranges };
		const without = new Set(checkViews({ ...views, hidden: [] }, ctx).map((i) => i.reason));
		return checkViews(views, ctx).filter((i) => !without.has(i.reason));
	});

	async function toggle(f: FeatureKey, box: HTMLInputElement) {
		const hidden = views.hidden.includes(f) ? views.hidden.filter((x) => x !== f) : [...views.hidden, f];
		const r = await viewOp({ op: 'patch', hidden });
		if (r) views = r.views;
		else {
			box.checked = !views.hidden.includes(f);
			showToast("Couldn't save. Are you online?");
		}
	}
</script>

<svelte:head><title>Features · Settings · ittracks</title></svelte:head>

<header class="bar">
	<h1>Features</h1>
	<a href="/settings">‹ Settings</a>
</header>

<section class="card stack">
	<p class="muted small-text" style="margin: 0">
		Switching a feature off hides its buttons and sections everywhere. Nothing is deleted, and switching it back on brings
		everything back.
	</p>
	<fieldset class="stack">
		<legend class="small-text">Features in use</legend>
		{#each Object.entries(FEATURES) as [k, label] (k)}
			<label style="color: var(--text)"
				><input type="checkbox" checked={!views.hidden.includes(k as FeatureKey)} onchange={(e) => toggle(k as FeatureKey, e.currentTarget)} /> {label}</label
			>
		{/each}
	</fieldset>
	{#each issues as i (i.reason)}<p class="small-text {i.severity === 'block' ? 'error' : 'muted'}" role="status" style="margin: 0">{i.reason}</p>{/each}
</section>

<style>
	fieldset {
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.small-text {
		font-size: 0.85rem;
	}
</style>
