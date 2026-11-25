<script lang="ts">
	// The selection bar: how many are ticked, select all shown, and one button per bulk action
	// for this kind of row (catalog.ts). An action asks for its input, previews exactly what it
	// will do (and what it leaves as it is, and why), then applies it in one go with Undo.
	// It talks to the same `bulk` action as the API and the MCP server.
	import { invalidateAll } from '$app/navigation';
	import { showToast } from '$lib/toast.svelte';
	import { buttonsFor, TARGETS, type BulkButton, type TargetKind } from './catalog';
	import { initialValues, type FieldSources } from './fields';
	import BulkForm from './BulkForm.svelte';

	interface Line {
		id: string;
		label: string;
		detail?: string;
	}
	interface Answer {
		preview: boolean;
		batch: string | null;
		summary: string;
		count: number;
		changes: Line[];
		skipped: { reason: string; items: Line[] }[];
		notes: string[];
	}

	let {
		kind,
		selected,
		visible,
		today,
		sources = {},
		onchanged = () => invalidateAll()
	}: {
		kind: TargetKind;
		/** Ticked ids, owned by the page (a SvelteSet shared with its lists). */
		selected: Set<string>;
		/** Ids of the rows shown now, for "Select all". */
		visible: string[];
		today: string;
		/** Option lists the action forms read (areas, fields, units). */
		sources?: FieldSources | ((ids: string[]) => FieldSources);
		/** After a change or its Undo. */
		onchanged?: () => unknown;
	} = $props();

	const t = $derived(TARGETS[kind]);
	const buttons = $derived(buttonsFor(kind));
	const ids = $derived([...selected]);
	const allShown = $derived(visible.length > 0 && visible.every((id) => selected.has(id)));
	const lists = $derived(typeof sources === 'function' ? sources(ids) : sources);

	let open = $state<BulkButton | null>(null);
	let values = $state<Record<string, unknown>>({});
	let preview = $state<Answer | null>(null);
	let busy = $state(false);
	let error = $state('');

	function pick(b: BulkButton) {
		if (open?.id === b.id) return close();
		open = b;
		values = initialValues(b.fields, today, lists);
		preview = null;
		error = '';
	}
	function close() {
		open = null;
		preview = null;
		error = '';
	}
	function selectAll() {
		if (allShown) for (const id of visible) selected.delete(id);
		else for (const id of visible) selected.add(id);
	}

	async function call(name: string, input: unknown): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
		try {
			const r = await fetch(`/api/v1/actions/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
			const body = await r.json();
			return body.ok ? { ok: true, result: body.result } : { ok: false, error: body.error?.message ?? 'Something went wrong.' };
		} catch {
			return { ok: false, error: "Couldn't reach the server. Are you online?" };
		}
	}

	const input = (apply: boolean) => {
		const raw = open!.toInput(values);
		// Optional text left empty is left out.
		const action = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
		return { action: { name: open!.action, ...action }, ids, apply };
	};

	async function run(apply: boolean) {
		if (!open || !ids.length) return;
		busy = true;
		error = '';
		const r = await call('bulk', input(apply));
		busy = false;
		if (!r.ok) {
			error = r.error;
			return;
		}
		const a = r.result as Answer;
		if (!apply) {
			preview = a;
			return;
		}
		close();
		await onchanged();
		if (!a.batch) return showToast(a.summary);
		showToast(`${a.summary}.`, async () => {
			const u = await call('bulk_undo', { batch: a.batch });
			if (!u.ok) return showToast(u.error);
			const res = u.result as { kept: number };
			await onchanged();
			showToast(res.kept ? `Undone. ${res.kept} changed again since, so ${res.kept === 1 ? 'it was' : 'they were'} kept.` : 'Undone.');
		}, 10000);
	}

	// A new selection or input makes an old preview wrong.
	$effect(() => {
		void ids.length;
		void JSON.stringify(values);
		preview = null;
	});
</script>

<section class="card bulk" aria-label="Change the selected {t.many}">
	<div class="row top">
		<strong class="grow" aria-live="polite">{ids.length ? `${ids.length} selected` : `Tick ${t.many} to change them together`}</strong>
		{#if visible.length}<button type="button" class="small" onclick={selectAll}>{allShown ? 'Clear shown' : `Select all ${visible.length} shown`}</button>{/if}
		{#if ids.length && !allShown}<button type="button" class="small" onclick={() => selected.clear()}>Clear</button>{/if}
	</div>
	<div class="row actions" role="toolbar" aria-label="Bulk actions">
		{#each buttons as b (b.id)}
			<button type="button" class="small" class:primary={open?.id === b.id} aria-expanded={open?.id === b.id} disabled={!ids.length} onclick={() => pick(b)}>{b.label}</button>
		{/each}
	</div>

	{#if open && ids.length}
		<form
			class="stack panel"
			onsubmit={(e) => {
				e.preventDefault();
				run(false);
			}}
		>
			<BulkForm fields={open.fields} bind:values sources={lists} />
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			{#if !preview}
				<div class="row">
					<button type="submit" class="primary" disabled={busy}>{busy ? 'Checking…' : `Preview for ${ids.length} ${ids.length === 1 ? t.one : t.many}`}</button>
					<button type="button" onclick={close}>Cancel</button>
				</div>
			{/if}
		</form>
	{/if}

	{#if open && preview}
		<div class="stack panel preview" aria-live="polite">
			{#if preview.count}
				<strong>{preview.count} {preview.count === 1 ? 'change' : 'changes'}</strong>
				<ul class="lines">
					{#each preview.changes as c (c.id)}<li><span>{c.label}</span>{#if c.detail}<span class="muted"> · {c.detail}</span>{/if}</li>{/each}
				</ul>
			{:else}
				<strong>Nothing would change.</strong>
			{/if}
			{#each preview.skipped as s (s.reason)}
				<div>
					<span class="muted">Left as {s.items.length === 1 ? 'it is' : 'they are'}: {s.reason}</span>
					<ul class="lines muted">
						{#each s.items as i (i.id + (i.detail ?? ''))}<li>{i.label}{#if i.detail}<span> · {i.detail}</span>{/if}</li>{/each}
					</ul>
				</div>
			{/each}
			{#each preview.notes as n (n)}<p class="muted note">{n}</p>{/each}
			<div class="row">
				{#if preview.count}
					<button type="button" class="primary" disabled={busy} onclick={() => run(true)}>{busy ? 'Working…' : `Apply ${preview.count} ${preview.count === 1 ? 'change' : 'changes'}`}</button>
				{/if}
				<button type="button" onclick={close}>Cancel</button>
			</div>
		</div>
	{/if}
</section>

<style>
	.bulk {
		margin: 0.75rem 0;
		border-color: var(--accent);
		position: sticky;
		top: 0.5rem;
		z-index: var(--z-sticky);
		max-height: 80vh;
		overflow: auto;
	}
	.top,
	.actions {
		align-items: center;
		flex-wrap: wrap;
	}
	.actions {
		margin-top: 0.5rem;
	}
	.panel {
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
	}
	.lines {
		margin: 0.25rem 0 0;
		padding-left: 1.1rem;
		font-size: 0.9rem;
	}
	.note {
		margin: 0;
		font-size: 0.85rem;
	}
	.error {
		color: var(--danger);
		margin: 0;
	}
</style>
