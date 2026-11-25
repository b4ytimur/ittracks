<script lang="ts">
	// Settings: one page of lines. Each opens where it stands and is saved as it is left, with Undo.
	import { tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { deserialize } from '$app/forms';
	import SaidLine from '$lib/detail/SaidLine.svelte';
	import { PAST_DAYS_CHOICES } from '$lib/engine/backfill';
	import { outbox } from '$lib/outbox.svelte';
	import { checkViews } from '$lib/rules/views';
	import type { SettingsSet } from '$lib/server/settings-patch';
	import Copy from '$lib/settings/Copy.svelte';
	import Keys from '$lib/settings/Keys.svelte';
	import { ELSEWHERE, FEATURE_HIDES, featureName, matches, settingGroups, type Line } from '$lib/settings/lines';
	import LogOut from '$lib/settings/LogOut.svelte';
	import Measures from '$lib/settings/Measures.svelte';
	import Parts from '$lib/settings/Parts.svelte';
	import QuickLinks from '$lib/settings/QuickLinks.svelte';
	import Reminders from '$lib/settings/Reminders.svelte';
	import Restore from '$lib/settings/Restore.svelte';
	import { NO_ANSWER, saveSetting } from '$lib/settings/save';
	import Template from '$lib/settings/Template.svelte';
	import Vacations from '$lib/settings/Vacations.svelte';
	import { statsOp } from '$lib/stats/client';
	import { formulaProblem } from '$lib/stats/formula';
	import { E1RM_PRESETS } from '$lib/stats/model';
	import { showError, showToast } from '$lib/toast.svelte';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import GroupHeading from '$lib/ui/GroupHeading.svelte';
	import { viewOp } from '$lib/viewclient';
	import { FEATURES, PAGES, PAGE_LABEL, ownChanges, type FeatureKey, type Page } from '$lib/views';

	let { data } = $props();

	const s = $derived(data.settings);
	const views = $derived(data.views);
	const preset = $derived(Object.values(E1RM_PRESETS).find((p) => p.formula === data.stats.e1rm)?.name ?? 'Your own formula');
	const groups = $derived(
		settingGroups({
			...s,
			today: data.today,
			username: data.username,
			vacations: data.vacations,
			journalOff: views.hidden.includes('journal'),
			measures: data.stats.measures,
			e1rm: { name: preset, maxReps: data.stats.e1rmMaxReps },
			muscle: data.stats.muscle,
			startPage: PAGE_LABEL[views.startPage],
			template: data.templates.find((t) => t.id === views.template)?.name ?? 'Custom',
			own: ownChanges(views).length,
			toCheck: data.viewIssues.length,
			hidden: views.hidden,
			devices: data.devices,
			habits: data.habits.length,
			keys: data.keys,
			waiting: outbox.items.length
		})
	);

	// ----- Finding one -----
	let q = $state('');
	const has = (l: Line, group: string) => matches(q.trim(), l.label, l.words, l.says, l.also, group);
	const shown = $derived(q.trim() ? groups.map((g) => ({ ...g, lines: g.lines.filter((l) => has(l, g.title)) })).filter((g) => g.lines.length) : groups);
	const elsewhere = $derived(q.trim() ? ELSEWHERE.filter((e) => matches(q.trim(), e.label, e.place, e.also)) : ELSEWHERE);
	const found = $derived(shown.reduce((n, g) => n + g.lines.length, 0) + elsewhere.length);

	// Folded groups, on this device. A search opens every match.
	const FOLDED = 'ittracks-settings-folded';
	let folded = $state<string[]>([]);
	$effect(() => {
		try {
			folded = JSON.parse(localStorage.getItem(FOLDED) ?? '[]');
		} catch {
			// Nothing remembered.
		}
	});
	const isFolded = (id: string) => !q.trim() && folded.includes(id);
	function fold(id: string) {
		folded = folded.includes(id) ? folded.filter((x) => x !== id) : [...folded, id];
		try {
			localStorage.setItem(FOLDED, JSON.stringify(folded));
		} catch {
			// Not remembered.
		}
	}

	let open = $state<Record<string, boolean>>({});
	let problem = $state<Record<string, string>>({});
	async function go(id: string) {
		const g = groups.find((x) => x.lines.some((l) => l.id === id));
		if (!g) return;
		q = '';
		folded = folded.filter((x) => x !== g.id);
		open[id] = true;
		await tick();
		document.getElementById(`line-${id}`)?.scrollIntoView({ block: 'center' });
		document.querySelector<HTMLElement>(`#line-${id} .fold`)?.focus({ preventScroll: true });
	}
	// A link to a line opens it.
	$effect(() => {
		const id = page.url.hash.slice(1);
		if (id) untrack(() => void tick().then(() => go(id)));
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
	async function save(line: string, set: SettingsSet, said: string, renames?: Record<string, string>) {
		const why = await saveSetting(set, () => Object.fromEntries(Object.keys(set).map((k) => [k, data.settings[k as keyof typeof data.settings]])) as SettingsSet, said, renames);
		if (why === NO_ANSWER) showError(why, () => save(line, set, said, renames));
		// The parts keep what is being typed.
		if (why && line !== 'parts') return void failed(line, why);
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
	async function stat(line: string, body: Record<string, unknown>, back: Record<string, unknown>, said: string) {
		try {
			await statsOp({ op: 'settings', ...body });
		} catch (e) {
			return void failed(line, navigator.onLine ? (e as Error).message : NO_ANSWER);
		}
		problem[line] = '';
		showToast(said, () => statsOp({ op: 'settings', ...back }).then(() => true));
		await invalidateAll();
	}
	function formula(f: string) {
		const bad = formulaProblem(f) ?? (!/\[\s*weight\s*\]/i.test(f) || !/\[\s*reps\s*\]/i.test(f) ? 'Not saved. The formula needs [Weight] and [Reps].' : '');
		if (bad) return void (problem.e1rm = bad);
		if (f !== data.stats.e1rm) stat('e1rm', { e1rm: f }, { e1rm: data.stats.e1rm }, 'Changed the 1RM formula.');
	}
	function weight(level: 'high' | 'medium' | 'low', v: number) {
		if (!(v >= 0 && v <= 1)) return void (problem.muscle = 'Not saved. A level counts between 0 and 1.');
		if (v !== data.stats.muscle[level]) stat('muscle', { muscle: { [level]: v } }, { muscle: { [level]: data.stats.muscle[level] } }, `A ${level} tag counts ${v} now.`);
	}

	// ----- Other apps -----
	let made = $state<{ name: string; secret: string } | null>(null);
	let pasted = $state('');
	const keyText = $derived(pasted.trim() || made?.secret || 'itk_…');
	const mcpConfig = $derived(JSON.stringify({ mcpServers: { ittracks: { command: 'node', args: ['/path/to/ittracks-mcp.mjs'], env: { ITTRACKS_URL: data.origin, ITTRACKS_KEY: keyText } } } }, null, 2));

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

<svelte:head><title>Settings · ittracks</title></svelte:head>

<EditChrome title="Settings" modes={['use']} hints={{ use: `Signed in as ${data.username}. ${Object.keys(FEATURES).length - views.hidden.length} of ${Object.keys(FEATURES).length} features in use.` }} />

<div class="search se-find" role="search">
	<label class="vh" for="se-q">Find a setting</label>
	<input id="se-q" type="search" placeholder="Find a setting" bind:value={q} autocomplete="off" />
	{#if q}<button type="button" class="quiet search-clear" aria-label="Clear search" onclick={() => ((q = ''), document.getElementById('se-q')?.focus())}>×</button>{/if}
	{#if q.trim()}<p class="result-line meta" role="status">{found} {found === 1 ? 'setting' : 'settings'}</p>{/if}
</div>

{#each shown as g (g.id)}
	<section class="se-sec su-sec" aria-label={g.title}>
		<GroupHeading title={g.title} count={String(g.lines.length)} folded={isFolded(g.id)} onfold={() => fold(g.id)} />
		{#if !isFolded(g.id)}
			<div class="card su-lines">
				{#each g.lines as l (l.id)}
					<SaidLine id={l.id} label={l.label} words={l.words} bind:open={() => !!open[l.id], (v) => (open[l.id] = v)} problem={problem[l.id]}>
						{#if l.id !== 'password'}<p class="field-hint meta">{l.says}</p>{/if}
						{#key drawn[l.id]}{@render body(l.id)}{/key}
					</SaidLine>
				{/each}
			</div>
		{/if}
	</section>
{/each}

{#if elsewhere.length}
	<section class="se-sec su-sec" aria-label="Set where they act">
		<GroupHeading title="Set where they act" count={String(elsewhere.length)} folded={isFolded('elsewhere')} onfold={() => fold('elsewhere')} />
		{#if !isFolded('elsewhere')}
			<ul class="card places">
				{#each elsewhere as e (e.label)}<li><a href={e.href}>{e.label}</a> <span class="meta muted">{e.place}</span></li>{/each}
			</ul>
		{/if}
	</section>
{/if}
{#if q.trim() && !found}<EmptyState kind="filtered" text="No setting matches “{q.trim()}”." clearLabel="Clear search" onclear={() => (q = '')} />{/if}

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
		<div class="option-row">
			<label class="check"><input type="checkbox" class="pick" checked={s.showAllSections} aria-describedby="all-h" onchange={(e) => save('newhabits', { showAllSections: e.currentTarget.checked }, e.currentTarget.checked ? 'A habit’s page shows every section.' : 'A habit’s page shows the sections in use.')} /> Show every section of a habit</label>
			<p class="field-hint meta" id="all-h">Otherwise a habit's page shows what it uses, and + Add brings the rest.</p>
		</div>
	{:else if id === 'units'}
		<div class="field"><label class="label" for="unit-w">Weights</label><input id="unit-w" class="short" list="weight-units" maxlength="20" value={s.weightUnit} onchange={(e) => save('units', { weightUnit: e.currentTarget.value.trim() }, `New Tasks start in ${e.currentTarget.value.trim()}.`)} /></div>
		<datalist id="weight-units"><option value="kg"></option><option value="lb"></option></datalist>
	{:else if id === 'measures'}
		<Measures measures={data.stats.measures} fields={data.stats.fields} />
	{:else if id === 'e1rm'}
		<div class="chips" role="radiogroup" aria-label="Formula">
			{#each Object.values(E1RM_PRESETS) as p (p.name)}<label class="toggle"><input type="radio" class="vh" name="e1rm" checked={data.stats.e1rm === p.formula} onchange={() => formula(p.formula)} />{p.name}</label>{/each}
		</div>
		<div class="field"><label class="label" for="e1rm-f">Formula</label><input id="e1rm-f" value={data.stats.e1rm} maxlength="300" spellcheck="false" autocomplete="off" onchange={(e) => formula(e.currentTarget.value.trim())} /></div>
		<div class="field"><label class="label" for="e1rm-n">For sets of this many reps or fewer</label><input id="e1rm-n" class="short" type="number" min="1" max="30" value={data.stats.e1rmMaxReps} onchange={(e) => { const n = Number(e.currentTarget.value); if (Number.isInteger(n) && n >= 1 && n <= 30) stat('e1rm', { e1rmMaxReps: n }, { e1rmMaxReps: data.stats.e1rmMaxReps }, `1RM is worked out for sets of ${n} reps or fewer.`); else problem.e1rm = 'Not saved. Pick 1 to 30 reps.'; }} /></div>
	{:else if id === 'muscle'}
		<div class="levels">
			{#each ['high', 'medium', 'low'] as const as l (l)}<div class="field"><label class="label" for="mw-{l}">{l[0].toUpperCase() + l.slice(1)}</label><input id="mw-{l}" type="number" min="0" max="1" step="0.05" value={data.stats.muscle[l]} onchange={(e) => weight(l, Number(e.currentTarget.value))} /></div>{/each}
		</div>
		{#if data.stats.muscle.high < data.stats.muscle.medium || data.stats.muscle.medium < data.stats.muscle.low}<p class="meta">A high tag usually counts at least as much as a medium one, and medium as much as low.</p>{/if}
	{:else if id === 'startpage'}
		<div class="chips" role="radiogroup" aria-label="Start page">
			{#each PAGES as p (p)}<label class="toggle"><input type="radio" class="vh" name="startpage" checked={views.startPage === p} onchange={() => view('startpage', { startPage: p }, { startPage: views.startPage as Page }, `The app opens on ${PAGE_LABEL[p]}.`)} /><span data-reserve={PAGE_LABEL[p]}>{PAGE_LABEL[p]}</span></label>{/each}
		</div>
	{:else if id === 'template'}
		<Template {views} templates={data.templates} issues={data.viewIssues} onfail={(why) => (why ? failed('template', why) : (problem.template = ''))} />
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
		<Reminders vapidKey={data.vapidKey} devices={data.devices} bind:problem={() => problem.reminders ?? '', (v) => (problem.reminders = v)} />
	{:else if id === 'download'}
		<div class="l-cluster"><a class="button hit" href="/api/v1/export?format=json" download>Everything (JSON)</a><a class="button hit" href="/api/v1/export?format=csv" download>Tables (CSV)</a></div>
	{:else if id === 'restore'}
		<Restore bind:problem={() => problem.restore ?? '', (v) => (problem.restore = v)} />
	{:else if id === 'journal'}
		{#if views.hidden.includes('journal')}<p class="meta">Turn the Journal on in <button type="button" class="link" onclick={() => go('features')}>Features</button> to download it.</p>
		{:else}<div><a class="button hit" href="/journal/export" download>Download the journal</a></div>{/if}
	{:else if id === 'templates'}
		<div class="l-cluster"><a class="button hit" href="/habits/import">Add a template file</a><a class="button hit" href="/gallery">Gallery</a></div>
		{#if data.habits.length}
			<ul class="habits">
				{#each data.habits as h (h.id)}
					<li class="act-row"><span class="status-text">{h.name}</span><span class="l-cluster"><a class="quiet hit" href="/habits/{h.id}/template.json" download aria-label="Save {h.name} as a file">Save as a file</a><a class="quiet hit" href="/habits/{h.id}/share" aria-label="Share {h.name}">Share…</a></span></li>
				{/each}
			</ul>
		{/if}
	{:else if id === 'keys'}
		<Keys keys={data.keys} habits={data.habits} scopes={data.scopes} bind:created={made} bind:problem={() => problem.keys ?? '', (v) => (problem.keys = v)} />
	{:else if id === 'links'}
		<QuickLinks habits={data.habits} fields={data.habitFields} origin={data.origin} {keyText} bind:secret={pasted} made={!!made} />
	{:else if id === 'assistants'}
		<ol class="meta steps">
			<li>Download <a href="/ittracks-mcp.mjs" download>ittracks-mcp.mjs</a>. It needs Node.js 18 or newer and nothing else.</li>
			<li>Make a key for it under <button type="button" class="link" onclick={() => go('keys')}>Keys</button> (Read, plus Log if it may log for you).</li>
			<li>Claude Desktop: Settings → Developer → Edit Config, and add: <Copy lines text={mcpConfig} label="the Claude Desktop config" /></li>
			<li>Claude Code: <Copy text="claude mcp add ittracks -e ITTRACKS_URL={data.origin} -e ITTRACKS_KEY={keyText} -- node /path/to/ittracks-mcp.mjs" label="the Claude Code command" /></li>
		</ol>
		<p class="meta">Replace <code>/path/to/</code> with where you saved the file. What the assistant reads is sent to its provider, so pick the access with that in mind.</p>
	{:else if id === 'scripts'}
		<Copy text={`curl -H "Authorization: Bearer ${keyText}" "${data.origin}/api/v1/export?format=csv" -o ittracks.zip`} label="the command" />
		<p class="meta">The actions the MCP server uses live under <code>/api/v1/actions</code>. They are still changing and aren't documented for other uses yet.</p>
	{:else if id === 'password'}
		<form class="l-stack" onsubmit={password}>
			<input class="vh" name="username" value={data.username} autocomplete="username" tabindex="-1" aria-hidden="true" readonly />
			<div class="field"><label class="label" for="pw-now">Current password</label><input id="pw-now" name="current" type="password" autocomplete="current-password" required /></div>
			<div class="field"><label class="label" for="pw-new">New password</label><p class="field-hint meta" id="pw-h">{groups.at(-1)!.lines[0].says}</p><input id="pw-new" name="next" type="password" autocomplete="new-password" minlength="8" required aria-describedby="pw-h" /></div>
			<div><button class="hit" aria-disabled={busy}>Change password</button></div>
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
	.levels {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-inline);
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
