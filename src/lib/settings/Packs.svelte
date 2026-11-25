<script lang="ts">
	// Starter packs: copied in and yours; taking one out removes only what nothing uses.
	import { invalidateAll } from '$app/navigation';
	import { PACKS } from '$lib/packs';
	import { showToast } from '$lib/toast.svelte';

	let { packs, problem = $bindable('') }: { packs: string[]; problem?: string } = $props();
	let busy = $state('');

	const send = async (body: object) => {
		const r = await fetch('/api/packs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
		return r && { ok: r.ok, data: (await r.json().catch(() => ({}))) as { undo?: unknown; kept?: string[]; error?: string } };
	};
	const list = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join(', ')} and ${xs.length - 3} more` : xs.join(', '));
	async function toggle(id: string, name: string) {
		if (busy) return;
		busy = id;
		const on = packs.includes(id);
		const r = await send({ op: on ? 'drop' : 'take', id });
		busy = '';
		if (!r?.ok) return void (problem = r?.data.error ?? 'Not changed. Are you online?');
		problem = '';
		const { undo, kept = [] } = r.data;
		showToast(on ? `Took ${name} out.${kept.length ? ` ${list(kept)} ${kept.length === 1 ? 'stays' : 'stay'}: something uses ${kept.length === 1 ? 'it' : 'them'}.` : ''}` : `${name} is yours now: change anything in it.`, async () => {
			const b = await send({ op: 'undo', undo });
			if (b) await invalidateAll();
			return b?.ok ? undefined : (b?.data.error ?? false);
		});
		await invalidateAll();
	}
</script>

<div class="l-stack" style="--gap: var(--space-inline)">
	{#each PACKS as p (p.id)}
		<div class="option-row">
			<label class="check"><input type="checkbox" class="pick" checked={packs.includes(p.id)} aria-describedby="pack-{p.id}" onclick={(e) => (e.preventDefault(), toggle(p.id, p.name))} /> {p.name}</label>
			<p class="field-hint meta" id="pack-{p.id}">{p.brings}</p>
		</div>
	{/each}
</div>

<style>
	p {
		margin: 0;
	}
</style>
