<script lang="ts">
	// Keys: each a row, revoking asks (it can't be undone), and a new one is shown once, here.
	import { invalidateAll } from '$app/navigation';
	import { deserialize } from '$app/forms';
	import Ask from '$lib/ui/Ask.svelte';
	import { runAction, showToast } from '$lib/toast.svelte';
	import Copy from './Copy.svelte';

	let {
		keys,
		habits,
		scopes,
		created = $bindable(null),
		problem = $bindable('')
	}: {
		keys: { id: string; name: string; hint: string; scopes: string[]; habitIds: string[] | null; createdAt: Date; lastUsedAt: Date | null }[];
		habits: { id: string; name: string }[];
		scopes: Record<string, string>;
		/** The key that was just made. Gone once it has been copied, or the page is left. */
		created?: { name: string; secret: string } | null;
		problem?: string;
	} = $props();

	const scopeNames: Record<string, string> = { read: 'Read', log: 'Log', notes: 'Notes', export: 'Export', edit: 'Edit' };
	const when = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : 'never');
	const habitName = (id: string) => habits.find((h) => h.id === id)?.name ?? 'an archived or deleted habit';
	let adding = $state(false);
	let limit = $state<'all' | 'some'>('all');
	let busy = $state(false);

	async function make(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		busy = true;
		problem = '';
		try {
			const res = await fetch('/settings?/createKey', { method: 'POST', body: new FormData(e.target as HTMLFormElement), headers: { 'x-sveltekit-action': 'true' } });
			const r = deserialize(await res.text());
			if (r.type === 'success') {
				created = (r.data as { created: { name: string; secret: string } }).created;
				adding = false;
				limit = 'all';
			} else problem = (r.type === 'failure' && (r.data as { error?: string })?.error) || 'Not made.';
		} catch {
			problem = 'Not made. Are you online?';
		}
		busy = false;
		await invalidateAll();
	}
	async function revoke(k: { id: string; name: string }) {
		const r = await runAction('/settings?/revokeKey', { id: k.id });
		if (r.ok) showToast(`Revoked ${k.name}.`);
		else problem = r.error ?? 'Not revoked. Are you online?';
		await invalidateAll();
	}
</script>

{#if created}
	<div class="new" role="status">
		<strong>Copy the key “{created.name}” now</strong>
		<p class="meta">It is shown only once. Anyone who has it can do what it allows, so keep it like a password. The examples under Quick-log links, AI assistants and Scripts use it until you close this.</p>
		<Copy text={created.secret} label="the key {created.name}" />
		<div><button type="button" class="hit" onclick={() => (created = null)}>I've copied it</button></div>
	</div>
{/if}
{#if keys.length}
	<ul>
		{#each keys as k (k.id)}
			<li class="se-key">
				<div class="act-row">
					<div>
						<strong>{k.name}</strong>
						<p class="meta muted"><code>{k.hint}…</code> · {k.scopes.map((s) => scopeNames[s]).join(', ')} · {k.habitIds ? `only ${k.habitIds.map(habitName).join(', ')}` : 'every habit'}</p>
						<p class="meta muted">Made {when(k.createdAt)}, last used {when(k.lastUsedAt)}</p>
					</div>
					<div class="ask-slot"><Ask label="Revoke" text="Revoke “{k.name}”? Anything that uses it stops working, and it can't be brought back." act="Revoke {k.name}" onact={() => revoke(k)} /></div>
				</div>
			</li>
		{/each}
	</ul>
{/if}
{#if adding}
	<form class="se-form l-stack" onsubmit={make}>
		<div class="field"><label class="label" for="key-name">Name</label><input id="key-name" name="name" maxlength="60" placeholder="iPhone Shortcuts, Claude, backup script…" required /></div>
		<fieldset class="field-group l-stack" style="--gap: var(--space-inline)">
			<legend class="label">It may</legend>
			{#each Object.entries(scopes) as [s, text] (s)}
				<div class="option-row">
					<label class="check"><input type="checkbox" class="pick" name="scope" value={s} checked={s === 'read' || s === 'log'} aria-describedby="scope-{s}" /> {scopeNames[s]}</label>
					<p class="field-hint meta" id="scope-{s}">{text}</p>
				</div>
			{/each}
		</fieldset>
		<fieldset class="field-group l-stack" style="--gap: var(--space-inline)">
			<legend class="label">For</legend>
			<label class="check"><input type="radio" class="choice" name="limit" value="all" bind:group={limit} /> Every habit, now and later</label>
			<label class="check"><input type="radio" class="choice" name="limit" value="some" bind:group={limit} /> Only some habits</label>
			{#if limit === 'some'}
				<div class="option-more l-stack" style="--gap: var(--space-tight)">
					{#each habits as h (h.id)}<label class="check"><input type="checkbox" class="pick" name="habit" value={h.id} /> {h.name}</label>{/each}
				</div>
			{/if}
		</fieldset>
		<p class="field-hint meta">For a Shortcut, Read and Log are enough. For an AI assistant, Read lets it analyse; add Log if it may log for you, and Notes only if it may read your notes and journal. A key limited to some habits can't download an export.</p>
		<div class="l-cluster"><button class="hit" aria-disabled={busy}>Make the key</button><button type="button" class="quiet hit" onclick={() => ((adding = false), (problem = ''))}>Cancel</button></div>
	</form>
{:else}
	<div><button type="button" class="hit" onclick={() => (adding = true)}>+ Key</button></div>
{/if}

<style>
	p {
		margin: 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.new {
		display: grid;
		gap: var(--space-inline);
	}
	.act-row:has(:global(.ask:not([hidden]))) > .ask-slot {
		flex-basis: 100%;
	}
</style>
