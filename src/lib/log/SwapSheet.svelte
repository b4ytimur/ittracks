<script lang="ts">
	// Swap for another…: a sheet from the bottom over the log, a modal dialog as Stats' Drill is. A tap on a row
	// swaps and closes it, with no Use or Cancel. The search takes focus with a keyboard only, so on touch no keyboard
	// comes up over the list. Arrows move through the search and the rows, Enter in the search takes the top match,
	// Esc closes, and focus goes back to where it was (the Task's ⋯).
	import { noRows, type PickRow } from './places';

	let {
		title,
		groups,
		onpick,
		onclose
	}: {
		title: string;
		/** The rows by group, for what is typed in the search. */
		groups: (query: string) => { label: string; rows: PickRow[] }[];
		onpick: (id: string) => void;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	let dialog = $state<HTMLDialogElement>();
	let search = $state<HTMLInputElement>();
	let query = $state('');
	const shown = $derived(groups(query));
	const count = $derived(shown.reduce((n, g) => n + g.rows.length, 0));

	$effect(() => {
		if (!dialog || dialog.open) return;
		dialog.showModal();
		if (matchMedia('(pointer: fine)').matches) search?.focus();
		else dialog.focus();
	});
	function pick(id: string) {
		dialog?.close();
		onpick(id);
	}
	function keys(e: KeyboardEvent) {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		e.preventDefault();
		const stops = [search!, ...dialog!.querySelectorAll<HTMLElement>('.swap-row:not(:disabled)')];
		const at = stops.indexOf(document.activeElement as HTMLElement);
		stops[(at + (e.key === 'ArrowDown' ? 1 : stops.length - 1)) % stops.length]?.focus();
	}
	/** Enter takes the top match. Esc closes at once, where a search field would first empty itself. */
	function searchKeys(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			dialog?.close();
		}
		if (e.key !== 'Enter') return;
		e.preventDefault();
		const top = shown.flatMap((g) => g.rows).find((r) => !r.disabled);
		if (top) pick(top.id);
	}
</script>

<!-- A tap on the scrim closes it: the dialog's own box is all .swap-body, so only the backdrop is the dialog itself. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} class="swap-sheet" aria-labelledby="{uid}-t" tabindex="-1" {onclose} onkeydown={keys} onclick={(e) => e.target === dialog && dialog.close()}>
	<div class="swap-body">
		<div class="swap-head">
			<h2 class="card-title" id="{uid}-t">{title}</h2>
			<button type="button" class="quiet" onclick={() => dialog?.close()}>Close</button>
		</div>
		<div class="field">
			<div class="search">
				<label
					><span class="vh">Search the Library</span>
					<input bind:this={search} bind:value={query} type="search" placeholder="Search the Library" autocomplete="off" autocorrect="off" enterkeyhint="go" onkeydown={searchKeys} /></label
				>
				<button
					type="button"
					class="quiet glyph search-clear focus-inset"
					aria-label="Clear search"
					onclick={() => {
						query = '';
						search?.focus();
					}}>×</button
				>
			</div>
		</div>
		<div class="swap-list">
			<!-- SearchField's line, said while searching or when nothing is left; its wrapper stays mounted, so it is announced. -->
			<div role="status">{#if query.trim() || !count}<p class="result-line meta num">{count ? `${count} ${count === 1 ? 'Task' : 'Tasks'}` : noRows(query)}</p>{/if}</div>
			{#each shown as g, n (g.label)}
				<h3 class="card-title" id="{uid}-g{n}">{g.label}</h3>
				<ul aria-labelledby="{uid}-g{n}">
					{#each g.rows as r (r.id)}
						<li>
							<button type="button" class="swap-row focus-inset" disabled={r.disabled} onclick={() => pick(r.id)}><span class="name">{r.name}</span><span class="meta">{r.meta}</span></button>
						</li>
					{/each}
				</ul>
			{/each}
		</div>
	</div>
</dialog>

<style>
	.swap-sheet {
		margin: auto auto 0;
		inline-size: min(var(--page-width), 100vw);
		max-inline-size: 100vw;
		max-block-size: 70dvh;
		padding: 0;
		border: 0;
		border-radius: var(--radius-card) var(--radius-card) 0 0;
		background: var(--surface-raised);
		color: var(--ink);
		box-shadow: var(--shadow-lifted);
	}
	/* Forced colours drop the shadow, so an edge marks where the sheet meets the page (as Menu's and Ask's do). */
	@media (forced-colors: active) {
		.swap-sheet {
			border: 1px solid CanvasText;
		}
	}
	.swap-sheet::backdrop {
		background: var(--scrim);
	}
	.swap-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-inline);
		max-block-size: 70dvh;
		padding: var(--space-inline) var(--space-group) var(--space-group);
	}
	.swap-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-inline);
		min-block-size: var(--target-touch);
	}
	h2,
	h3 {
		margin: 0;
	}
	h3 {
		margin-block-start: var(--space-group);
	}
	.swap-list {
		overflow-y: auto;
		min-block-size: 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	/* A row: its name and one line under it, 56px, the whole row one target. */
	.swap-row {
		flex-direction: column;
		align-items: flex-start;
		gap: 0;
		inline-size: 100%;
		min-block-size: var(--target-act);
		padding: 0;
		border: 0;
		border-block-start: 1px solid var(--line);
		border-radius: 0;
		background: none;
		text-align: start;
	}
	.swap-row .name {
		font-weight: 600;
	}
	.swap-row .meta {
		color: var(--ink-muted);
	}
	.swap-row:disabled {
		cursor: default;
		color: var(--ink-muted);
	}
	@media (hover: hover) {
		.swap-row:not(:disabled):hover {
			background: var(--surface-hover);
		}
	}
</style>
