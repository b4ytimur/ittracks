<script lang="ts">
	// Who you want to be: a list of sentences, each with its habits and what shows it, in words. The page exists to keep
	// this list and a sentence opens nothing, so it is always arranged: tap a sentence to change it, its grip moves it,
	// Delete is the row's one verb, and the slot at the end adds one. No mode.
	import { invalidateAll } from '$app/navigation';
	import { runAction, showError, showToast, undoWith } from '$lib/toast.svelte';
	import EditableList from '$lib/ui/EditableList.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import InlineText from '$lib/ui/InlineText.svelte';
	import TitleLine from '$lib/ui/TitleLine.svelte';

	let { data } = $props();
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
		const added = r?.added;
		if (added)
			showToast(`Added “${statement}”.`, async () => {
				// An Undo of a Delete may have given it that one's habits since: then it stays, and the band says so.
				const u = await runAction<{ kept: boolean }>('/identities?/unadd', { id: added });
				return u.ok && (u.data?.kept ? `Not undone: “${statement}” has habits now, so it stays.` : true);
			});
		else if (r) showToast(`“${statement}” is there already.`);
	}
	async function rename(i: Row, statement: string) {
		const r = await run<{ taken: boolean }>('rename', { id: i.id, statement });
		if (r?.taken) showToast(`“${statement}” is there already.`);
		else if (r)
			showToast(`Changed “${i.statement}”.`, async () => {
				// Another one may say the old sentence by now: that is refused too, and the band says so.
				const u = await runAction<{ taken: boolean }>('/identities?/rename', { id: i.id, statement: i.statement });
				return u.ok && (u.data?.taken ? `Not undone: “${i.statement}” is there already.` : true);
			});
	}
	async function remove(i: Row) {
		const r = await run<{ deleted: object }>('delete', { id: i.id });
		if (r?.deleted) showToast(`Deleted “${i.statement}”. Its habits stay.`, undoWith('/identities?/restore', { deleted: JSON.stringify(r.deleted) }));
	}
	async function move(ids: string[], said: string) {
		const was = list.map((i) => i.id);
		order = ids;
		if (await run('order', { ids: ids.join(',') })) showToast(said, undoWith('/identities?/order', { ids: was.join(',') }));
		order = null;
	}
</script>

<svelte:head><title>Identities · ittracks</title></svelte:head>

<TitleLine title="Identities" back={{ href: '/habits', label: 'Habits' }} hint="Who do you want to be? Press a sentence to change it." />

{#if !list.length}<EmptyState text="None yet. Write one as a sentence, such as “I am someone who speaks Spanish”." />{/if}
<EditableList
	items={list}
	key={(i) => i.id}
	label={(i) => i.statement}
	rowCard
	ariaLabel="Identities"
	onmove={(_, ids, text) => (void move(ids, text), true)}
	onremove={remove}
	removeLabel="Delete"
	onadd={add}
	addLabel="New identity"
>
	{#snippet row(i)}
		<span class="name"><InlineText value={i.statement} editing label="Change identity" onsave={(v) => rename(i, v)} /></span>
		<p class="meta-line meta">{evidence(i)}</p>
	{/snippet}
	{#snippet lines(i)}
		{#if i.habits.length}<p class="row-line meta">{#each i.habits as h, n (h.id)}{n ? ' · ' : ''}<a href="/habits/{h.id}">{h.name}</a>{/each}</p>{/if}
	{/snippet}
</EditableList>
