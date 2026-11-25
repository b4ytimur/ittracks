<script lang="ts">
	// Who you want to be: an editable list of sentences, each with its habits and what shows it, in words.
	import { invalidateAll } from '$app/navigation';
	import { runAction, showError, showToast, undoWith } from '$lib/toast.svelte';
	import EditableList from '$lib/ui/EditableList.svelte';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import InlineText from '$lib/ui/InlineText.svelte';
	import type { Mode } from '$lib/ui/list';

	let { data } = $props();
	let mode = $state<Mode>('use');
	let order = $state.raw<string[] | null>(null);
	const list = $derived(order ? [...data.identities].sort((a, b) => order!.indexOf(a.id) - order!.indexOf(b.id)) : data.identities);
	type Row = (typeof data.identities)[number];

	const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
	/** Words, never a score, and never that there was nothing. */
	const evidence = (i: Row) =>
		i.week ? `You did it ${times(i.week)} this week${i.total > i.week ? `, ${times(i.total)} in all` : ''}.` : i.total ? `You did it ${times(i.total)} so far.` : i.habits.length ? 'It starts with the next one you do.' : 'No habit stands for it yet. Pick it on a habit’s page, under Identity.';

	async function run<T>(action: string, fields: Record<string, string>): Promise<T | null> {
		const r = await runAction<T>(`/identities?/${action}`, fields);
		if (!r.ok) return showError(r.error ?? 'Not saved. Are you online?'), null;
		await invalidateAll();
		return (r.data ?? {}) as T;
	}
	async function add(name?: string) {
		const statement = name?.trim();
		if (!statement) return;
		const r = await run<{ added: string | null }>('add', { statement });
		if (r?.added) showToast(`Added “${statement}”.`, undoWith('/identities?/delete', { id: r.added }));
		else if (r) showToast(`“${statement}” is there already.`);
	}
	async function rename(i: Row, statement: string) {
		if (await run('rename', { id: i.id, statement })) showToast(`Changed “${i.statement}”.`, undoWith('/identities?/rename', { id: i.id, statement: i.statement }));
	}
	async function remove(i: Row) {
		const r = await run<{ deleted: object }>('delete', { id: i.id });
		if (r?.deleted) showToast(`Deleted “${i.statement}”. Its habits stay.`, undoWith('/identities?/restore', { deleted: JSON.stringify(r.deleted) }));
	}
	async function move(ids: string[]) {
		const was = list.map((i) => i.id);
		order = ids;
		if (await run('order', { ids: ids.join(',') })) showToast('Moved it.', undoWith('/identities?/order', { ids: was.join(',') }));
		order = null;
	}
</script>

<svelte:head><title>Identities · ittracks</title></svelte:head>

<EditChrome title="Identities" bind:mode modes={list.length ? ['use', 'edit'] : ['use']} back={{ href: '/', label: 'Today' }} hints={{ use: 'Who do you want to be? A habit stands for one when you pick it on the habit’s page.', edit: 'Press a sentence to change it.' }} />

{#if !list.length}<EmptyState text="None yet. Write one as a sentence, such as “I am someone who speaks Spanish”." />{/if}
<EditableList
	items={list}
	key={(i) => i.id}
	label={(i) => i.statement}
	{mode}
	rowCard
	ariaLabel="Identities"
	onmove={(_, ids) => move(ids)}
	onremove={remove}
	removeLabel="Delete"
	onadd={add}
	addLabel="+ Identity"
	addInUse
>
	{#snippet row(i)}
		<span class="name"><InlineText value={i.statement} editing={mode === 'edit'} label="Change “{i.statement}”" onsave={(v) => rename(i, v)} /></span>
		<p class="meta-line meta">{evidence(i)}</p>
		{#if i.habits.length}<p class="row-line meta">{#each i.habits as h, n (h.id)}{n ? ' · ' : ''}<a href="/habits/{h.id}">{h.name}</a>{/each}</p>{/if}
	{/snippet}
</EditableList>
