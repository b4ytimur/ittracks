<script lang="ts">
	// Edit on a log: the Tasks in plan order with their names and the plan's numbers to change, and
	// inside an open Task its rows to drag. The plan changes from now on; a row's place is this log's only.
	import EditableList from '$lib/ui/EditableList.svelte';
	import InlineText from '$lib/ui/InlineText.svelte';
	import { cap, rowText, type Field, type RowState } from './run';
	import { numberIn } from './plan';

	export interface PlanNumber {
		id: string;
		text: string;
		label: string;
	}
	export interface EditPlace {
		id: string;
		name: string;
		/** A Task to rename; none when nothing in the Library fits the place. */
		task: string | null;
		numbers: PlanNumber[];
		rows: { key: string; name: string; one: string; many: string; fields: Field[]; sets: RowState[]; previous: Record<string, unknown>[] }[];
	}
	let {
		places,
		open,
		onorder,
		onname,
		onnumber,
		onrows,
		onremove,
		onadd,
		library
	}: {
		places: EditPlace[];
		/** The Task whose rows show first. */
		open: string | null;
		onorder: (order: string[], moved: string) => void;
		onname: (p: EditPlace, name: string) => void;
		onnumber: (p: EditPlace, id: string, n: number) => void;
		onrows: (key: string, rows: RowState[], moved: RowState) => void;
		onremove: (p: EditPlace) => void;
		onadd: (task: string) => void;
		/** What can be added. */
		library: { id: string; name: string }[];
	} = $props();

	let shown = $state<Record<string, boolean>>({});
	const isOpen = (p: EditPlace) => p.rows.length > 0 && (shown[p.id] ?? p.id === open);

	// Rows have no id of their own; they are the same objects for as long as the page is open.
	const ids = new WeakMap<RowState, string>();
	let next = 0;
	const idOf = (r: RowState) => ids.get(r) ?? (ids.set(r, String(next++)), ids.get(r)!);
</script>

<EditableList
	items={places}
	key={(p) => p.id}
	label={(p) => p.name}
	mode="edit"
	rowCard
	holder={isOpen}
	class="lg-page lg-places"
	ariaLabel="What to log"
	onmove={(m, order) => (onorder(order, m.key), true)}
	onremove={(p) => onremove(p)}
>
	{#snippet row(p)}
		<h2 class="name">{#if p.task}<InlineText editing value={p.name} label="Name of the Task" onsave={(v) => onname(p, v)} />{:else}{p.name}{/if}</h2>
		{#if p.rows.length}<button type="button" class="fold hit" aria-expanded={isOpen(p)} aria-label="{cap(p.rows[0].many)} of {p.name}" onclick={() => (shown[p.id] = !isOpen(p))}><span aria-hidden="true" class="chev">›</span></button>{/if}
		{#if p.numbers.length}
			<p class="meta-line numbers">
				{#each p.numbers as n (n.id)}
					<InlineText
						editing
						value={n.text}
						label="{n.label} of {p.name}"
						maxlength={20}
						onsave={(v) => {
							const x = numberIn(v);
							if (x !== null) onnumber(p, n.id, x);
						}}
					/>
				{/each}
			</p>
		{/if}
	{/snippet}
	{#snippet children(p)}
		{#each p.rows as r (r.key)}
			{#if p.rows.length > 1}<p class="label">{r.name}</p>{/if}
			<EditableList
				items={r.sets}
				key={idOf}
				label={(s) => `${cap(r.one)} ${r.sets.indexOf(s) + 1}`}
				mode="edit"
				rowCard
				ariaLabel="{cap(r.many)} of {r.name}"
				onmove={(m, order) => (onrows(r.key, order.map((k) => r.sets.find((s) => idOf(s) === k)!), r.sets.find((s) => idOf(s) === m.key)!), true)}
			>
				{#snippet row(s, ctx)}
					<span class="num"><span class="vh">{cap(r.one)} </span>{ctx.index + 1}</span>
					<span class="lg-val"><bdi dir="ltr">{rowText(r.fields, s.values) || '–'}</bdi></span>
					{#if s.done}<span class="label">done</span>{:else if r.previous[ctx.index]}<span class="label"><bdi dir="ltr">Last {rowText(r.fields, r.previous[ctx.index])}</bdi></span>{/if}
				{/snippet}
			</EditableList>
		{/each}
	{/snippet}
</EditableList>
<label class="add"
	><span class="vh">Add a Task, from now on</span><select
		value=""
		onchange={(e) => {
			const id = e.currentTarget.value;
			e.currentTarget.value = '';
			if (id) onadd(id);
		}}
	>
		<option value="">+ Task…</option>
		{#each library as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
	</select></label
>

<style>
	.add > select {
		width: auto;
		max-inline-size: 100%;
	}
	p,
	h2 {
		margin: 0;
	}
	h2 {
		flex: 1;
	}
	.numbers {
		display: flex;
		flex-wrap: wrap;
		flex-basis: 100%;
		gap: 0 var(--space-group);
	}
	/* Several on one line: each rule is as wide as its words. */
	.numbers > :global(button.inline-text)::after {
		width: 0;
	}
	.numbers > :global(input.inline-text) {
		width: 10ch;
	}
	.num {
		min-inline-size: var(--lg-lead);
	}
</style>
