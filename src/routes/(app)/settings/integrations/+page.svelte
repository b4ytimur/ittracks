<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const scopeNames: Record<string, string> = { read: 'Read', log: 'Log', notes: 'Notes', export: 'Export' };
	const when = (d: Date | null) =>
		d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : 'never';
	const habitName = (id: string) => data.habits.find((h) => h.id === id)?.name ?? 'an archived or deleted habit';

	// New key form
	let limit = $state<'all' | 'some'>('all');
	const picked = $derived(new Set((form && 'scopes' in form ? form.scopes : null) ?? ['read', 'log']));

	// The key that was just made: shown once, and used by the builders below.
	const created = $derived(form && 'created' in form ? form.created : null);
	let pasted = $state('');
	const key = $derived(pasted.trim() || created?.secret || '');
	const keyShown = $derived(key || 'itk_…');

	// Quick-log link builder
	let habitId = $state('');
	let value = $state('');
	let field = $state('');
	let craving = $state(false);
	let spoken = $state(false);
	const chosen = $derived(data.habits.find((h) => h.id === (habitId || data.habits[0]?.id)) ?? null);
	const fields = $derived(chosen ? (data.fields[chosen.id] ?? []) : []);
	const fieldUsed = $derived(fields.includes(field) ? field : (fields[0] ?? ''));
	const link = $derived.by(() => {
		if (!chosen) return '';
		const q = new URLSearchParams({ key: keyShown });
		if (chosen.direction === 'break' && craving) q.set('craving', '1');
		else if (value.trim()) {
			q.set('value', value.trim());
			if (fields.length > 1) q.set('field', fieldUsed);
		}
		if (spoken) q.set('reply', 'text');
		return `${data.origin}/q/${chosen.id}?${q.toString().replace('itk_%E2%80%A6', 'itk_…')}`;
	});
	const what = $derived.by(() => {
		if (!chosen) return '';
		if (chosen.direction === 'break') return craving ? 'logs a resisted craving' : value.trim() ? `logs ${value.trim()} slips` : 'logs a slip';
		if (value.trim()) return `adds ${value.trim()} to ${fieldUsed || 'its number'}, and marks the habit done once the target is reached`;
		return 'marks it done (copying your last log when it has Tasks)';
	});

	const mcpConfig = $derived(
		JSON.stringify(
			{ mcpServers: { ittracks: { command: 'node', args: ['/path/to/ittracks-mcp.mjs'], env: { ITTRACKS_URL: data.origin, ITTRACKS_KEY: keyShown } } } },
			null,
			2
		)
	);
	const claudeCode = $derived(`claude mcp add ittracks -e ITTRACKS_URL=${data.origin} -e ITTRACKS_KEY=${keyShown} -- node /path/to/ittracks-mcp.mjs`);
	const curl = $derived(`curl -H "Authorization: Bearer ${keyShown}" "${data.origin}/api/v1/export?format=csv" -o ittracks.zip`);

	let copied = $state('');
	async function copy(text: string, name: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = name;
			setTimeout(() => copied === name && (copied = ''), 2000);
		} catch {
			copied = '';
		}
	}
</script>

<svelte:head><title>Integrations · Settings · ittracks</title></svelte:head>

<header class="bar">
	<h1>Integrations</h1>
	<a href="/settings">‹ Settings</a>
</header>

<p class="muted small-text">
	Keys let other things use ittracks as you: a Shortcut or NFC tag that logs a glass of water, an AI assistant that reads
	your logs and does the math, or a script that downloads a backup. Each key gets only the access you pick, and you can
	revoke it at any time.
</p>

{#snippet copyable(text: string, name: string, multiline = false)}
	<div class="copy">
		{#if multiline}<pre>{text}</pre>{:else}<code class="line">{text}</code>{/if}
		<button type="button" class="small" onclick={() => copy(text, name)}>{copied === name ? 'Copied' : 'Copy'}</button>
	</div>
{/snippet}

<h2>Keys</h2>

{#if created}
	<section class="card stack new-key">
		<strong>Copy your new key “{created.name}” now</strong>
		<p class="muted small-text" style="margin: 0">It is shown only once. Anyone who has it can do what it allows, so keep it like a password.</p>
		{@render copyable(created.secret, 'secret')}
		<p class="muted small-text" style="margin: 0">The examples below use it until you leave this page.</p>
	</section>
{/if}

{#if data.keys.length}
	<ul class="list">
		{#each data.keys as k (k.id)}
			<li class="card">
				<div class="row" style="align-items: center">
					<div class="grow">
						<strong>{k.name}</strong>
						<div class="muted small-text"><code>{k.hint}…</code> · made {when(k.createdAt)} · last used {when(k.lastUsedAt)}</div>
						<div class="chips">
							{#each k.scopes as s (s)}<span class="chip on">{scopeNames[s]}</span>{/each}
							<span class="chip">{k.habitIds ? `Only ${k.habitIds.map(habitName).join(', ')}` : 'Every habit'}</span>
						</div>
					</div>
					<form method="POST" action="?/revoke" use:enhance>
						<input type="hidden" name="id" value={k.id} />
						<button
							class="danger small"
							onclick={(e) => !confirm(`Revoke “${k.name}”? Anything using it stops working.`) && e.preventDefault()}>Revoke</button
						>
					</form>
				</div>
			</li>
		{/each}
	</ul>
{:else}
	<p class="muted">No keys yet.</p>
{/if}

<details class="card" open={!data.keys.length || !!(form && 'error' in form)}>
	<summary><strong>New key</strong></summary>
	<form method="POST" action="?/create" class="stack" style="margin-top: 0.75rem" use:enhance>
		<label>Name <input name="name" maxlength="60" placeholder="iPhone Shortcuts, Claude, backup script…" required value={form && 'name' in form ? form.name : ''} /></label>
		<fieldset class="plain">
			<legend class="muted small-text">It may</legend>
			{#each Object.entries(data.scopes) as [s, text] (s)}
				<label class="check"><input type="checkbox" name="scope" value={s} checked={picked.has(s)} /> <span><strong>{scopeNames[s]}</strong> · {text}</span></label>
			{/each}
		</fieldset>
		<fieldset class="plain">
			<legend class="muted small-text">For</legend>
			<label class="check"><input type="radio" name="limit" value="all" bind:group={limit} /> Every habit, now and later</label>
			<label class="check"><input type="radio" name="limit" value="some" bind:group={limit} /> Only some habits</label>
			{#if limit === 'some'}
				<div class="habits">
					{#each data.habits as h (h.id)}
						<label class="check"><input type="checkbox" name="habit" value={h.id} /> {h.name}</label>
					{/each}
				</div>
			{/if}
		</fieldset>
		<p class="muted small-text" style="margin: 0">
			For a Shortcut, Read and Log are enough. For an AI assistant, Read lets it analyse; add Log if it may log for you, and
			Notes only if it may read your notes and journal. A key limited to some habits can't download an export.
		</p>
		{#if form && 'error' in form}<p class="error" style="margin: 0">{form.error}</p>{/if}
		<button class="primary">Make key</button>
	</form>
</details>

<h2>Quick-log links</h2>
<section class="card stack">
	<p class="muted small-text" style="margin: 0">
		A link that logs as soon as it is opened, from a Shortcut, Siri, an NFC tag, a QR code or a home screen bookmark. Signed
		in, the same link works without a key.
	</p>
	{#if data.habits.length}
		<div class="row">
			<label class="grow">Habit
				<select bind:value={() => chosen?.id ?? '', (v) => (habitId = v)}>
					{#each data.habits as h (h.id)}<option value={h.id}>{h.name}</option>{/each}
				</select>
			</label>
			{#if chosen?.direction === 'break'}
				<label class="grow">How many slips <input inputmode="numeric" bind:value placeholder="1" disabled={craving} /></label>
			{:else}
				<label class="grow">Value (optional) <input inputmode="decimal" bind:value placeholder="e.g. 250" /></label>
				{#if fields.length > 1}
					<label class="grow">Field
						<select bind:value={() => fieldUsed, (v) => (field = v)}>
							{#each fields as f (f)}<option value={f}>{f}</option>{/each}
						</select>
					</label>
				{/if}
			{/if}
		</div>
		{#if chosen?.direction === 'break'}<label class="check"><input type="checkbox" bind:checked={craving} /> A resisted craving instead of a slip</label>{/if}
		<label class="check"><input type="checkbox" bind:checked={spoken} /> Answer in plain text, for Siri to read out</label>
		{#if !created}
			<label>Key for the link (paste one, or make a new key above) <input bind:value={pasted} placeholder="itk_…" autocomplete="off" /></label>
		{/if}
		{@render copyable(link, 'link')}
		<p class="muted small-text" style="margin: 0">Opening it {what}. It answers with one line, such as “Drink water: 6 of 8 glasses”.</p>
		<details>
			<summary class="small-text">iPhone: Shortcuts, Siri and NFC</summary>
			<ol class="small-text">
				<li>In Shortcuts, make a new shortcut with <em>Get Contents of URL</em> and paste the link.</li>
				<li>To be asked for the amount each time, add <em>Ask for Input</em> (Number) first, and put its answer in place of the value in the link.</li>
				<li>Add <em>Show Result</em> or <em>Speak Text</em> with the contents, and turn on “Answer in plain text” above.</li>
				<li>Name it like you would say it (“Log water”) to use it with Siri. For a tag: Automation → NFC → run this shortcut.</li>
			</ol>
		</details>
		<details>
			<summary class="small-text">Android, QR codes and scripts</summary>
			<p class="small-text">
				An app such as HTTP Shortcuts or Tasker can call the link from a home screen button or an NFC tag. An NFC tag or QR
				code that just holds the link opens it in the browser, which logs and shows the result. Programs can also send a
				POST with the key in an <code>Authorization: Bearer</code> header instead of the link. Opening the same link twice
				within a few seconds logs once.
			</p>
		</details>
	{:else}
		<p class="muted" style="margin: 0">Add a habit first.</p>
	{/if}
	<p class="muted small-text" style="margin: 0">Anyone with a link that has a key in it can log with it. Keep links private, and revoke the key if one gets out.</p>
</section>

<h2>AI assistants (MCP)</h2>
<section class="card stack">
	<p class="muted small-text" style="margin: 0">
		Claude, Cursor and other assistants that support MCP can read your habits, do the math on this server (rates, streaks,
		trends, correlations) and point to the logs their answers rest on. They log only when you ask.
	</p>
	<ol class="small-text stack" style="margin: 0; padding-left: 1.2rem">
		<li>Download <a href="/ittracks-mcp.mjs" download>ittracks-mcp.mjs</a>. It needs Node.js 18 or newer and nothing else.</li>
		<li>Make a key for it above (Read, plus Log if it may log for you).</li>
		<li>
			Claude Desktop: Settings → Developer → Edit Config, and add:
			{@render copyable(mcpConfig, 'mcp', true)}
		</li>
		<li>Claude Code: {@render copyable(claudeCode, 'cc')}</li>
	</ol>
	<p class="muted small-text" style="margin: 0">
		Replace <code>/path/to/</code> with where you saved the file. What the assistant reads is sent to its provider, so pick the
		access with that in mind. Try asking it for a weekly review, or whether your sleep affects your training.
	</p>
</section>

<h2>Scripts</h2>
<section class="card stack">
	<p class="muted small-text" style="margin: 0">
		A key with Export access can download the same export as <a href="/settings/data">Data</a>, for example for a nightly backup:
	</p>
	{@render copyable(curl, 'curl')}
	<p class="muted small-text" style="margin: 0">
		The actions the MCP server uses live under <code>/api/v1/actions</code>. They are still changing and aren't documented
		for other uses yet.
	</p>
</section>

<style>
	.small-text {
		font-size: 0.85rem;
	}
	.new-key {
		border-color: var(--accent);
	}
	.copy {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}
	.copy code.line,
	.copy pre {
		flex: 1;
		min-width: 0;
		margin: 0;
		padding: 0.45rem 0.6rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		font-size: 0.8rem;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}
	.copy pre {
		overflow-x: auto;
		white-space: pre;
	}
	fieldset.plain {
		border: none;
		padding: 0;
		margin: 0;
	}
	label.check {
		display: flex;
		align-items: baseline;
		gap: 0.1rem;
		color: var(--text);
		margin-top: 0.4rem;
	}
	.habits {
		padding-left: 1.4rem;
	}
	summary {
		cursor: pointer;
	}
	ol li + li {
		margin-top: 0.35rem;
	}
</style>
