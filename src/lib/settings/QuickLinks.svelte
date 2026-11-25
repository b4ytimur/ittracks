<script lang="ts">
	// A link that logs when it is opened, put together here.
	import Copy from './Copy.svelte';

	let {
		habits,
		fields,
		origin,
		keyText,
		secret = $bindable(''),
		made
	}: {
		habits: { id: string; name: string; direction: string }[];
		fields: Record<string, string[]>;
		origin: string;
		/** The key as the examples show it. */
		keyText: string;
		secret?: string;
		/** A key was just made, so none has to be pasted. */
		made: boolean;
	} = $props();

	let habitId = $state('');
	let value = $state('');
	let field = $state('');
	let craving = $state(false);
	let spoken = $state(false);
	const chosen = $derived(habits.find((h) => h.id === habitId) ?? habits[0] ?? null);
	const own = $derived(chosen ? (fields[chosen.id] ?? []) : []);
	const fieldUsed = $derived(own.includes(field) ? field : (own[0] ?? ''));
	const link = $derived.by(() => {
		if (!chosen) return '';
		const q = new URLSearchParams({ key: keyText });
		if (chosen.direction === 'break' && craving) q.set('craving', '1');
		else if (value.trim()) {
			q.set('value', value.trim());
			if (own.length > 1) q.set('field', fieldUsed);
		}
		if (spoken) q.set('reply', 'text');
		return `${origin}/q/${chosen.id}?${q.toString().replace('itk_%E2%80%A6', 'itk_…')}`;
	});
	const what = $derived.by(() => {
		if (!chosen) return '';
		if (chosen.direction === 'break') return craving ? 'logs a resisted craving' : value.trim() ? `logs ${value.trim()} slips` : 'logs a slip';
		if (value.trim()) return `adds ${value.trim()} to ${fieldUsed || 'its number'}, and marks the habit done once the target is reached`;
		return 'marks it done (copying your last log when it has Tasks)';
	});
</script>

{#if chosen}
	<div class="field">
		<label class="label" for="ql-habit">Habit</label>
		<select id="ql-habit" bind:value={() => chosen.id, (v) => (habitId = v)}>{#each habits as h (h.id)}<option value={h.id}>{h.name}</option>{/each}</select>
	</div>
	{#if chosen.direction === 'break'}
		<label class="check"><input type="checkbox" class="pick" bind:checked={craving} /> A resisted craving instead of a slip</label>
		{#if !craving}<div class="field"><label class="label" for="ql-slips">How many slips</label><input id="ql-slips" inputmode="numeric" bind:value placeholder="1" /></div>{/if}
	{:else}
		<div class="se-dates">
			<div class="field"><label class="label" for="ql-value">Value</label><input id="ql-value" inputmode="decimal" bind:value placeholder="Optional, such as 250" /></div>
			{#if own.length > 1}
				<div class="field"><label class="label" for="ql-field">Field</label><select id="ql-field" bind:value={() => fieldUsed, (v) => (field = v)}>{#each own as f (f)}<option value={f}>{f}</option>{/each}</select></div>
			{/if}
		</div>
	{/if}
	<label class="check"><input type="checkbox" class="pick" bind:checked={spoken} /> Answer in plain text, for Siri to read out</label>
	{#if !made}
		<div class="field"><label class="label" for="ql-key">Key for the link</label><p class="field-hint meta" id="ql-key-h">Paste one, or make one under Keys.</p><input id="ql-key" bind:value={secret} placeholder="itk_…" autocomplete="off" aria-describedby="ql-key-h" /></div>
	{/if}
	<Copy text={link} label="the link" />
	<p class="meta">Opening it {what}. It answers with one line, such as “Drink water: 6 of 8 glasses”. Signed in, <code>/q/&lt;habit&gt;</code> opens today's quick log, and <code>?go=1</code> logs “Same as last time” at once.</p>
	<details>
		<summary class="meta">iPhone: Shortcuts, Siri and NFC</summary>
		<ol class="meta">
			<li>In Shortcuts, make a new shortcut with <em>Get Contents of URL</em> and paste the link.</li>
			<li>To be asked for the amount each time, add <em>Ask for Input</em> (Number) first, and put its answer in place of the value in the link.</li>
			<li>Add <em>Show Result</em> or <em>Speak Text</em> with the contents, and turn on “Answer in plain text” above.</li>
			<li>Name it like you would say it (“Log water”) to use it with Siri. For a tag: Automation → NFC → run this shortcut.</li>
		</ol>
	</details>
	<details>
		<summary class="meta">Android, QR codes and scripts</summary>
		<p class="meta">
			An app such as HTTP Shortcuts or Tasker can call the link from a home screen button or an NFC tag. An NFC tag or QR code that just holds the link opens it in the browser, which logs and shows the result. Programs can also send a POST with the key in an <code>Authorization: Bearer</code> header instead of the link. Opening the same link twice within a few seconds logs once.
		</p>
	</details>
{:else}
	<p class="meta">Add a habit first.</p>
{/if}

<style>
	p {
		margin: 0;
	}
</style>
