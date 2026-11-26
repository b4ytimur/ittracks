<script lang="ts">
	// Settings: one page of lines. Each opens where it stands and is saved as it is left, with Undo.
	import { tick, untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { deserialize } from '$app/forms';
	import SaidLine from '$lib/detail/SaidLine.svelte';
	import { PAST_DAYS_CHOICES } from '$lib/engine/backfill';
	import { outbox } from '$lib/outbox.svelte';
	import { checkViews } from '$lib/rules/views';
	import type { SettingsSet } from '$lib/server/settings-patch';
	import Backups from '$lib/settings/Backups.svelte';
	import Copy from '$lib/settings/Copy.svelte';
	import Groupings from '$lib/settings/Groupings.svelte';
	import Keys from '$lib/settings/Keys.svelte';
	import { ELSEWHERE, FEATURE_HIDES, featureName, matches, settingGroups, type Line } from '$lib/settings/lines';
	import LogOut from '$lib/settings/LogOut.svelte';
	import Measures from '$lib/settings/Measures.svelte';
	import Packs from '$lib/settings/Packs.svelte';
	import Parts from '$lib/settings/Parts.svelte';
	import QuickLinks from '$lib/settings/QuickLinks.svelte';
	import Reminders from '$lib/settings/Reminders.svelte';
	import Restore from '$lib/settings/Restore.svelte';
	import { NO_ANSWER, saveSetting } from '$lib/settings/save';
	import TaskTypes from '$lib/settings/TaskTypes.svelte';
	import Units from '$lib/settings/Units.svelte';
	import Vacations from '$lib/settings/Vacations.svelte';
	import { showError, showToast } from '$lib/toast.svelte';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import GroupHeading from '$lib/ui/GroupHeading.svelte';
	import { viewOp } from '$lib/viewclient';
	import { FEATURES, PAGES, PAGE_LABEL, type FeatureKey, type Page } from '$lib/views';

	let { data } = $props();

	const s = $derived(data.settings);
	const views = $derived(data.views);
	const groups = $derived(
		settingGroups({
			...s,
			today: data.today,
			username: data.username,
			vacations: data.vacations,
			journalOff: views.hidden.includes('journal'),
			measures: data.stats.measures,
			packs: data.packs,
			startPage: PAGE_LABEL[views.startPage],
			hidden: views.hidden,
			devices: data.devices,
			habits: data.habits.length,
			keys: data.keys,
			backup: data.backup,
			waiting: outbox.items.length
		})
	);

	// ----- Finding one -----
	let q = $state('');
	const has = (l: Line, group: string) => matches(q.trim(), l.label, l.words, l.says, l.also, group);
	const shown = $derived(q.trim() ? groups.map((g) => ({ ...g, lines: g.lines.filter((l) => has(l, g.title)) })).filter((g) => g.lines.length) : groups);
	const elsewhere = $derived(q.trim() ? ELSEWHERE.filter((e) => matches(q.trim(), e.label, e.place, e.also)) : ELSEWHERE);
	const found = $derived(shown.reduce((n, g) => n + g.lines.length, 0) + elsewhere.length);

	// ----- Which group shows (TS.15) -----
	// One group at a time, every line open. ?g= names it; a link to a line (#past) shows the line's group. On a wide
	// screen the first group shows until another is pressed; on a phone the list of groups shows instead.
	const wide = new MediaQuery('min-width: 64rem');
	const ofLine = (id: string) => groups.find((g) => g.lines.some((l) => l.id === id))?.id;
	const chosen = $derived.by(() => {
		const g = page.url.searchParams.get('g');
		if (g === 'elsewhere' || groups.some((x) => x.id === g)) return g;
		return ofLine(page.url.hash.slice(1)) ?? (wide.current ? groups[0].id : null);
	});
	const group = $derived(groups.find((g) => g.id === chosen));
	const searching = $derived(!!q.trim());

	let problem = $state<Record<string, string>>({});
	/** A line in view, and focus on its first control. */
	async function show(id: string) {
		await tick();
		document.getElementById(`line-${id}`)?.scrollIntoView({ block: 'center' });
		document.querySelector<HTMLElement>(`#line-${id} > .su-body :is(input, select, button, a)`)?.focus({ preventScroll: true });
	}
	/** A link from one line to another: the other's group, then the line. */
	function go(id: string) {
		const g = ofLine(id);
		if (!g) return;
		q = '';
		void goto(`?g=${g}#${id}`);
	}
	// A link to a line shows it.
	$effect(() => {
		const id = page.url.hash.slice(1);
		if (id) untrack(() => void show(id));
	});

	// ----- Saving -----
	let drawn = $state<Record<string, number>>({});
	/** It wasn't saved: say why, and show the line's controls as they are saved. */
	async function failed(line: string, why: string) {
		problem[line] = why;
		const controls = () => [...document.querySelectorAll<HTMLElement>(`#line-${line} > .su-body :is(input, button, select)`)];
		const at = controls().indexOf(document.activeElement as HTMLElement);
		drawn[line] = (drawn[line] ?? 0) + 1;
		await tick();
		controls()[at]?.focus();
	}
	async function save(line: string, set: SettingsSet, said: string, renames?: Record<string, string>, unitRenames?: Record<string, string>) {
		const why = await saveSetting(set, () => Object.fromEntries(Object.keys(set).map((k) => [k, data.settings[k as keyof typeof data.settings]])) as SettingsSet, said, renames, unitRenames);
		if (why === NO_ANSWER) showError(why, () => save(line, set, said, renames, unitRenames));
		// These keep what is being typed.
		if (why && !['parts', 'units', 'groupings'].includes(line)) return void failed(line, why);
		problem[line] = why;
	}
	async function view(line: string, body: Record<string, unknown>, back: Record<string, unknown>, said: string) {
		const r = await viewOp({ op: 'patch', ...body });
		if (!r) {
			showError(NO_ANSWER, () => view(line, body, back, said));
			return void failed(line, NO_ANSWER);
		}
		problem[line] = '';
		showToast(said, async () => !!(await viewOp({ op: 'patch', ...back })));
		await invalidateAll();
	}
	function toggle(f: FeatureKey) {
		const was = [...views.hidden];
		const off = !was.includes(f);
		view('features', { hidden: off ? [...was, f] : was.filter((x) => x !== f) }, { hidden: was }, `${featureName(f)} ${off ? 'is off. What you set in it is kept.' : 'is on.'}`);
	}
	/** What the view rules say only because a feature is off. */
	const offIssues = $derived.by(() => {
		const without = new Set(checkViews({ ...views, hidden: [] }, { ranges: s.ranges.length }).map((i) => i.reason));
		return data.viewIssues.filter((i) => !without.has(i.reason));
	});
	// ----- Other apps -----
	let made = $state<{ name: string; secret: string } | null>(null);
	let pasted = $state('');
	const keyText = $derived(pasted.trim() || made?.secret || 'itk_…');
	// The AI assistant script lives in ~/.ittracks: macOS doesn't let Claude Desktop read Documents, Desktop or Downloads.
	const mcpGet = $derived(`mkdir -p ~/.ittracks && curl -fsS ${data.origin}/ittracks-mcp.mjs -o ~/.ittracks/ittracks-mcp.mjs && echo ~/.ittracks/ittracks-mcp.mjs`);
	// Claude Desktop runs it without a shell, so it needs the whole path, which the command above prints.
	const mcpConfig = $derived(JSON.stringify({ mcpServers: { ittracks: { command: 'node', args: ['/Users/you/.ittracks/ittracks-mcp.mjs'], env: { ITTRACKS_URL: data.origin, ITTRACKS_KEY: keyText } } } }, null, 2));

	let busy = $state(false);
	async function password(e: SubmitEvent) {
		e.preventDefault();
		const form = e.target as HTMLFormElement;
		if (busy) return;
		busy = true;
		try {
			const res = await fetch('/settings?/password', { method: 'POST', body: new FormData(form), headers: { 'x-sveltekit-action': 'true' } });
			const r = deserialize(await res.text());
			problem.password = r.type === 'success' ? '' : ((r.type === 'failure' && (r.data as { error?: string })?.error) || 'Not changed.');
			if (r.type === 'success') {
				form.reset();
				showToast('Password changed.');
			}
		} catch {
			problem.password = 'Not changed. Are you online?';
		}
		busy = false;
	}
</script>

<svelte:head><title>{chosen && !wide.current ? `${group?.title ?? 'Set where they act'} · Settings` : 'Settings'} · ittracks</title></svelte:head>

{#if chosen && !wide.current}
	<!-- A phone: a group is a page of its own. -->
	<EditChrome title={group?.title ?? 'Set where they act'} modes={['use']} back={{ href: '/settings', label: 'Settings' }} hints={{ use: group ? `${group.lines.length} ${group.lines.length === 1 ? 'setting' : 'settings'}` : `${ELSEWHERE.length} places, each on its own page` }} />
{:else}
	<EditChrome title="Settings" modes={['use']} hints={{ use: `Signed in as ${data.username}. ${Object.keys(FEATURES).length - views.hidden.length} of ${Object.keys(FEATURES).length} features in use.` }} />
	<div class="search se-find page-wide" role="search">
		<label class="vh" for="se-q">Find a setting</label>
		<input id="se-q" type="search" placeholder="Find a setting" bind:value={q} autocomplete="off" />
		{#if q}<button type="button" class="quiet glyph search-clear focus-inset" aria-label="Clear search" onclick={() => ((q = ''), document.getElementById('se-q')?.focus())}>×</button>{/if}
		{#if searching}<p class="result-line meta" role="status">{found} {found === 1 ? 'setting' : 'settings'}</p>{/if}
	</div>
{/if}

<div class="page-cols">
	<div class="page-main">
		{#if searching}
			<!-- A search lists the matching lines from every group, open. -->
			{#each shown as g (g.id)}{@render groupLines(g.title, g.lines, true)}{/each}
			{#if elsewhere.length}{@render places(elsewhere, true)}{/if}
			{#if !found}<EmptyState kind="filtered" text="No setting matches “{q.trim()}”." clearLabel="Clear search" onclear={() => (q = '')} />{/if}
		{:else if chosen === 'elsewhere'}
			{@render places(ELSEWHERE, wide.current)}
		{:else if group}
			{@render groupLines(group.title, group.lines, wide.current)}
		{:else}
			<!-- A phone: the groups, each with what it is set to. -->
			<nav class="card se-groups" aria-label="Settings groups">
				{#each groups as g (g.id)}
					<a class="se-group" href="?g={g.id}"><span class="se-group-text"><span class="se-group-name">{g.title}</span><span class="se-group-says meta">{g.lines.map((l) => l.words).join(' ')}</span></span><span class="chev" aria-hidden="true">›</span></a>
				{/each}
				<a class="se-group" href="?g=elsewhere"><span class="se-group-text"><span class="se-group-name">Set where they act</span><span class="se-group-says meta">{ELSEWHERE.map((e) => e.label).join(', ')}.</span></span><span class="chev" aria-hidden="true">›</span></a>
			</nav>
		{/if}
	</div>
	<!-- From 64rem, the groups beside the one shown: the way around Settings, in view while it scrolls (TS.15). -->
	{#if wide.current}
		<aside class="page-side se-index" aria-label="Settings groups">
			<GroupHeading title="Groups" />
			<nav class="side-card side-list" aria-label="Settings groups">
				{#each groups as g (g.id)}<a class="side-row" href="?g={g.id}" aria-current={!searching && chosen === g.id ? 'page' : undefined} onclick={() => (q = '')}>{g.title}<span class="num">{g.lines.length}</span></a>{/each}
				<a class="side-row" href="?g=elsewhere" aria-current={!searching && chosen === 'elsewhere' ? 'page' : undefined} onclick={() => (q = '')}>Set where they act<span class="num">{ELSEWHERE.length}</span></a>
			</nav>
		</aside>
	{/if}
</div>

{#snippet groupLines(title: string, ls: Line[], head: boolean)}
	<section class="se-sec su-sec" aria-label={title}>
		{#if head}<GroupHeading {title} count={String(ls.length)} />{/if}
		<div class="card su-lines">
			{#each ls as l (l.id)}
				<SaidLine id={l.id} label={l.label} words={l.words} always problem={problem[l.id]}>
					{#if l.id !== 'password'}<p class="field-hint meta">{l.says}</p>{/if}
					{#key drawn[l.id]}{@render body(l.id)}{/key}
				</SaidLine>
			{/each}
		</div>
	</section>
{/snippet}

{#snippet places(list: typeof ELSEWHERE, head: boolean)}
	<section class="se-sec su-sec" aria-label="Set where they act">
		{#if head}<GroupHeading title="Set where they act" count={String(list.length)} />{/if}
		<ul class="card places">
			{#each list as e (e.label)}<li><a href={e.href}>{e.label}</a> <span class="meta muted">{e.place}</span></li>{/each}
		</ul>
	</section>
{/snippet}

{#snippet body(id: string)}
	{#if id === 'daystart'}
		<div class="field"><label class="label" for="daystart-t">Day starts at</label><input id="daystart-t" type="time" class="short" value={s.dayStart ?? '00:00'} onblur={(e) => e.currentTarget.value && e.currentTarget.value !== (s.dayStart ?? '00:00') && save('daystart', { dayStart: e.currentTarget.value }, `The day starts at ${e.currentTarget.value} now.`)} /></div>
	{:else if id === 'parts'}
		<Parts ranges={s.ranges} used={data.usedRanges} bind:problem={() => problem.parts ?? '', (v) => (problem.parts = v)} onsave={(ranges, said, renames) => save('parts', { ranges }, said, renames)} />
	{:else if id === 'vacation'}
		<Vacations vacations={data.vacations} today={data.today} bind:problem={() => problem.vacation ?? '', (v) => (problem.vacation = v)} />
	{:else if id === 'past'}
		<div class="l-stack" style="--gap: var(--space-inline)" role="radiogroup" aria-label="How far back you can log">
			{#each PAST_DAYS_CHOICES as c (c.label)}
				<label class="check"><input type="radio" class="choice" name="past" checked={s.pastDays === c.value} onchange={() => save('past', { pastDays: c.value }, `Past days: ${c.label}.`)} /> {c.label}</label>
			{/each}
		</div>
		{#if s.pastDays !== 0}
			<div class="option-row">
				<label class="check"><input type="checkbox" class="pick" checked={s.nudgeYesterday} aria-describedby="nudge-h" onchange={(e) => save('past', { nudgeYesterday: e.currentTarget.checked }, e.currentTarget.checked ? 'Today asks about yesterday.' : 'Today no longer asks about yesterday.')} /> Ask about yesterday</label>
				<p class="field-hint meta" id="nudge-h">A line on Today when yesterday has habits left unlogged.</p>
			</div>
		{/if}
	{:else if id === 'daynote'}
		<label class="check"><input type="checkbox" class="pick" checked={s.dayNote} onchange={(e) => save('daynote', { dayNote: e.currentTarget.checked }, e.currentTarget.checked ? 'The day note is on Today.' : 'The day note is off. What you wrote is kept.')} /> A day note on Today</label>
		{#if views.hidden.includes('journal')}<p class="meta">The Journal is switched off, so the note stays hidden. <button type="button" class="link" onclick={() => go('features')}>Features</button></p>{/if}
		<p class="meta"><a href="/history?notes">Everything you wrote</a> is in History.</p>
	{:else if id === 'newhabits'}
		<div class="option-row">
			<label class="check"><input type="checkbox" class="pick" checked={s.guidedSetup} aria-describedby="guided-h" onchange={(e) => save('newhabits', { guidedSetup: e.currentTarget.checked }, e.currentTarget.checked ? 'New habits ask how to start.' : 'New habits open the full page.')} /> Ask how to start</label>
			<p class="field-hint meta" id="guided-h">From the Gallery, step by step, as a copy, or blank.</p>
		</div>
	{:else if id === 'units'}
		<Units kinds={s.units} used={data.usedUnits} bind:problem={() => problem.units ?? '', (v) => (problem.units = v)} onsave={(units, said, renames) => save('units', { units }, said, {}, renames)} />
	{:else if id === 'measures'}
		<Measures measures={data.stats.measures} fields={data.stats.fields} suggestions={data.stats.suggestions} />
	{:else if id === 'groupings'}
		<Groupings groupings={s.groupings} tags={data.tags} bind:problem={() => problem.groupings ?? '', (v) => (problem.groupings = v)} onsave={(groupings, said) => save('groupings', { groupings }, said)} />
	{:else if id === 'types'}
		<TaskTypes types={s.taskTypes} plain={data.plainTypes} bind:problem={() => problem.types ?? '', (v) => (problem.types = v)} onsave={(taskTypes, said) => save('types', { taskTypes }, said)} />
	{:else if id === 'packs'}
		<Packs packs={data.packs} bind:problem={() => problem.packs ?? '', (v) => (problem.packs = v)} />
	{:else if id === 'startpage'}
		<div class="chips" role="radiogroup" aria-label="Start page">
			{#each PAGES as p (p)}<label class="toggle"><input type="radio" class="vh" name="startpage" checked={views.startPage === p} onchange={() => view('startpage', { startPage: p }, { startPage: views.startPage as Page }, `The app opens on ${PAGE_LABEL[p]}.`)} /><span data-reserve={PAGE_LABEL[p]}>{PAGE_LABEL[p]}</span></label>{/each}
		</div>
	{:else if id === 'features'}
		<div class="l-stack" style="--gap: var(--space-inline)">
			{#each Object.keys(FEATURES) as FeatureKey[] as f (f)}
				<div class="option-row">
					<label class="check"><input type="checkbox" class="pick" checked={!views.hidden.includes(f)} aria-describedby="f-{f}" onchange={() => toggle(f)} /> {featureName(f)}</label>
					<p class="field-hint meta" id="f-{f}">Off: {FEATURE_HIDES[f][0].toLowerCase() + FEATURE_HIDES[f].slice(1)}</p>
				</div>
			{/each}
		</div>
		{#each offIssues as i (i.reason)}<p class="meta" role="status">{i.reason}</p>{/each}
	{:else if id === 'reminders'}
		<Reminders vapidKey={data.vapidKey} devices={data.devices} reminders={data.reminders} bind:problem={() => problem.reminders ?? '', (v) => (problem.reminders = v)} />
	{:else if id === 'download'}
		<div class="l-cluster"><a class="button" href="/api/v1/export?format=json" download>Everything (JSON)</a><a class="button" href="/api/v1/export?format=csv" download>Tables (CSV)</a></div>
	{:else if id === 'backups'}
		<Backups plan={data.backup.plan} last={data.backup.state} container={data.backup.container} bind:problem={() => problem.backups ?? '', (v) => (problem.backups = v)} />
	{:else if id === 'restore'}
		<Restore bind:problem={() => problem.restore ?? '', (v) => (problem.restore = v)} />
	{:else if id === 'journal'}
		{#if views.hidden.includes('journal')}<p class="meta">Turn the Journal on in <button type="button" class="link" onclick={() => go('features')}>Features</button> to download it.</p>
		{:else}<div><a class="button" href="/journal/export" download>Download the journal</a></div>{/if}
	{:else if id === 'templates'}
		<div class="l-cluster"><a class="button" href="/habits/import">Add a template file</a><a class="button" href="/gallery">Gallery</a></div>
		{#if data.habits.length}
			<ul class="habits">
				{#each data.habits as h (h.id)}
					<li class="act-row"><span class="status-text">{h.name}</span><span class="l-cluster"><a class="quiet" href="/habits/{h.id}/template.json" download aria-label="Save {h.name} as a file">Save as a file</a><a class="quiet" href="/habits/{h.id}/share" aria-label="Share {h.name}">Share…</a></span></li>
				{/each}
			</ul>
		{/if}
	{:else if id === 'keys'}
		<Keys keys={data.keys} habits={data.habits} scopes={data.scopes} bind:created={made} bind:problem={() => problem.keys ?? '', (v) => (problem.keys = v)} />
	{:else if id === 'links'}
		<QuickLinks habits={data.habits} fields={data.habitFields} origin={data.origin} {keyText} bind:secret={pasted} made={!!made} />
	{:else if id === 'assistants'}
		<ol class="meta steps">
			<li>
				Save <a href="/ittracks-mcp.mjs" download>ittracks-mcp.mjs</a> in <code>~/.ittracks/</code>, not in Documents, Desktop or Downloads: macOS doesn't let Claude Desktop read those. It needs Node.js 18 or newer and nothing else. From the repository, <code>make mcp</code> does it and prints the config with your path. Or in Terminal, which prints where the file is:
				<Copy text={mcpGet} label="the download command" />
			</li>
			<li>Make a key for it under <button type="button" class="link" onclick={() => go('keys')}>Keys</button> (Read, plus Log if it may log for you, and Edit if it may set up and change habits with you).</li>
			<li>Claude Desktop: Settings → Developer → Edit Config, add this, and put the path the command printed in place of <code>/Users/you/.ittracks/ittracks-mcp.mjs</code>: <Copy lines text={mcpConfig} label="the Claude Desktop config" /></li>
			<li>Claude Code: <Copy text="claude mcp add ittracks -e ITTRACKS_URL={data.origin} -e ITTRACKS_KEY={keyText} -- node ~/.ittracks/ittracks-mcp.mjs" label="the Claude Code command" /></li>
		</ol>
		<p class="meta">What the assistant reads is sent to its provider, so pick the access with that in mind.</p>
	{:else if id === 'scripts'}
		<Copy text={`curl -H "Authorization: Bearer ${keyText}" "${data.origin}/api/v1/export?format=csv" -o ittracks.zip`} label="the command" />
		<p class="meta">The actions the MCP server uses live under <code>/api/v1/actions</code>. They are still changing and aren't documented for other uses yet.</p>
	{:else if id === 'password'}
		<form class="l-stack" onsubmit={password}>
			<input class="vh" name="username" value={data.username} autocomplete="username" tabindex="-1" aria-hidden="true" readonly />
			<div class="field"><label class="label" for="pw-now">Current password</label><input id="pw-now" name="current" type="password" autocomplete="current-password" required /></div>
			<div class="field"><label class="label" for="pw-new">New password</label><p class="field-hint meta" id="pw-h">{groups.at(-1)!.lines[0].says}</p><input id="pw-new" name="next" type="password" autocomplete="new-password" minlength="8" required aria-describedby="pw-h" /></div>
			<div><button aria-disabled={busy}>Change password</button></div>
		</form>
	{:else if id === 'logout'}
		<LogOut />
	{/if}
{/snippet}

<style>
	p {
		margin: 0;
	}
	.short {
		width: 9rem;
	}
	.places,
	.habits {
		list-style: none;
		margin: 0;
		padding-inline-start: 0;
	}
	.places {
		padding: var(--space-inline) var(--space-group);
	}
	.places li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 var(--space-inline);
		min-height: var(--control-md);
	}
	.steps {
		margin: 0;
		padding-inline-start: 1.2rem;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-inline);
	}
	.se-sec + .se-sec {
		margin-block-start: var(--space-section);
	}
	.search {
		margin-block-start: var(--space-inline);
	}
	button.link {
		padding: 0;
		border: 0;
		min-height: 0;
		background: none;
		color: var(--accent-ink);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
</style>
