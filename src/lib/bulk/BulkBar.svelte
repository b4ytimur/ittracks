<script lang="ts">
	// The selection bar: how many are ticked, select all shown, and one button per bulk action
	// for this kind of row (catalog.ts). An action asks for its input, previews exactly what it
	// will do (and what it leaves as it is, and why), then applies it in one go with Undo.
	// It talks to the same `bulk` action as the API and the MCP server.
	import { invalidateAll } from '$app/navigation';
	import { band, showToast } from '$lib/toast.svelte';
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
		outcome = $bindable(new Map()),
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
		/** What the open action will do to each row, for the page to show on it. */
		outcome?: Map<string, { tag?: string; reason?: string }>;
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

	let asked = 0;
	async function run(apply: boolean) {
		if (!open || !ids.length) return;
		const mine = ++asked;
		busy = apply;
		error = '';
		const r = await call('bulk', input(apply));
		// The selection or the input changed while it was away.
		if (mine !== asked) return;
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
		if (!a.batch) return void showToast(a.summary);
		showToast(`${a.summary}.`, async () => {
			const u = await call('bulk_undo', { batch: a.batch });
			if (!u.ok) return u.error;
			const res = u.result as { kept: number };
			await onchanged();
			showToast(res.kept ? `Undone. ${res.kept} changed again since, so ${res.kept === 1 ? 'it was' : 'they were'} kept.` : 'Undone.');
		});
	}

	// A new selection or input makes an old preview wrong: ask again, a moment after the last change.
	let form = $state<HTMLFormElement>();
	$effect(() => {
		void ids.length;
		void JSON.stringify(values);
		const on = open && ids.length;
		preview = null;
		asked++;
		busy = false;
		const t = setTimeout(() => on && (!form || form.checkValidity()) && run(false), 300);
		return () => clearTimeout(t);
	});
	$effect(() => {
		outcome = new Map<string, { tag?: string; reason?: string }>([
			...(preview?.skipped ?? []).flatMap((s) => s.items.map((i) => [i.id, { reason: s.reason }] as const)),
			...(preview?.changes ?? []).map((c) => [c.id, { tag: c.detail || 'Changes' }] as const)
		]);
	});
	/** Items left as they are: an item that changes on some days and stays on others changes. */
	const left = $derived.by(() => {
		const changes = new Set((preview?.changes ?? []).map((c) => c.id));
		return new Set((preview?.skipped ?? []).flatMap((s) => s.items.map((i) => i.id)).filter((id) => !changes.has(id))).size;
	});
	const say = $derived(
		error ||
			(!preview
				? form && !form.checkValidity()
					? 'Fill in what it needs to see what changes.'
					: 'Checking…'
				: preview.count
					? `${preview.count} ${preview.count === 1 ? 'changes' : 'change'}${left ? `, ${left} ${left === 1 ? 'stays' : 'stay'}` : ''}. ${preview.notes.join(' ')}`.trim()
					: 'Nothing would change.')
	);
	const ready = $derived(!!preview?.count && !busy);
	/** Bring the next row that changes into view. */
	let at = -1;
	function jump() {
		const els = (preview?.changes ?? []).map((c) => document.querySelector<HTMLElement>(`li[data-key="${CSS.escape(c.id)}"]`)).filter((x) => x !== null);
		if (!els.length) return;
		at = (at + 1) % els.length;
		els[at].scrollIntoView({ block: 'center' });
	}
	$effect(() => {
		band.select = bar;
		// Closing the bar takes its preview off the page's rows too.
		return () => {
			band.select = null;
			outcome = new Map();
		};
	});
</script>

{#snippet bar()}
	<section class="selbar" aria-label="Change the selected {t.many}">
		<p class="selbar-head">
			<span class="selbar-count num" aria-live="polite">{ids.length ? `${ids.length} selected` : 'None selected'}</span>
			{#if visible.length && !allShown}<button class="link meta" type="button" onclick={selectAll}>Select all {visible.length}</button>{/if}
			{#if ids.length}<button class="link meta" type="button" onclick={() => selected.clear()}>Clear</button>{/if}
		</p>
		{#if ids.length}
			<div class="chips selbar-acts" role="group" aria-label="Change" inert={busy}>
				{#each buttons as b (b.id)}
					<button type="button" class="toggle" aria-pressed={open?.id === b.id} onclick={() => pick(b)}>{b.label}</button>
				{/each}
			</div>
		{/if}
		{#if open && ids.length}
			<form
				bind:this={form}
				class="stack panel"
				inert={busy}
				onsubmit={(e) => {
					e.preventDefault();
					if (ready) run(true);
				}}
			>
				<BulkForm fields={open.fields} bind:values sources={lists} />
				<div class="selbar-commit">
					<p class="selbar-say" role="status">{say}</p>
					{#if (preview?.count ?? 0) > 1}<button class="link meta" type="button" onclick={jump}>Jump to next</button>{/if}
					<span class="selbar-go">
						<button class="small primary" aria-disabled={!ready}>{busy ? 'Applying…' : preview?.count ? `Apply ${preview.count} ${preview.count === 1 ? 'change' : 'changes'}` : 'Apply'}</button>
						<button class="small" type="button" onclick={close}>Cancel</button>
					</span>
				</div>
			</form>
		{/if}
	</section>
{/snippet}

<style>
	.selbar-head,
	.selbar-say {
		margin: 0;
	}
	.panel {
		margin-top: var(--space-inline);
	}
</style>
