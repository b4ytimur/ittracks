<script lang="ts">
	// What every page shows, at once. Your own changes stay on top unless you drop them.
	import { invalidateAll } from '$app/navigation';
	import { showError, showToast } from '$lib/toast.svelte';
	import { viewOp } from '$lib/viewclient';
	import { ownChanges, type ViewSettings } from '$lib/views';

	let { views, templates, issues }: { views: ViewSettings; templates: { id: string; name: string; blurb: string; summary: string }[]; issues: { reason: string }[] } = $props();

	const mine = $derived(ownChanges(views));
	const name = $derived(templates.find((t) => t.id === views.template)?.name ?? 'Custom');
	async function use(id: string, keep: boolean) {
		const t = templates.find((x) => x.id === id)!;
		const kept = keep && mine.length > 0;
		const r = await viewOp({ op: 'template', id, keep });
		if (!r) {
			showError('Not switched. Are you online?', () => use(id, keep));
			return void (await invalidateAll());
		}
		const before = r.previous;
		await invalidateAll();
		showToast(keep ? `Switched to ${t.name}${kept ? ', your own changes kept' : ''}.` : `Went back to ${t.name} as it comes.`, async () => !!(await viewOp({ op: 'restore', views: before })));
	}
</script>

<fieldset class="l-stack" style="--gap: var(--space-inline)">
	<legend class="vh">View template</legend>
	{#each templates as t (t.id)}
		<div class="option-row">
			<label class="check"><input type="radio" class="choice" name="template" value={t.id} checked={t.id === views.template} aria-describedby="tpl-{t.id}" onchange={() => use(t.id, true)} /> {t.name}</label>
			<p class="field-hint meta" id="tpl-{t.id}">{t.blurb} {t.summary}</p>
		</div>
	{/each}
</fieldset>
{#if mine.length}
	<div>
		<p class="meta">Yours on top of {name}: {mine.map((c) => c.label).join(', ')}.</p>
		<button type="button" class="quiet hit" onclick={() => use(views.template, false)}>Drop these</button>
	</div>
{/if}
{#each issues as i (i.reason)}<p class="meta" role="status">{i.reason}</p>{/each}

<style>
	p {
		margin: 0;
	}
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
	}
</style>
