<script lang="ts">
	// Build your own card: pick what it reads, how each log becomes a number, how numbers
	// combine, and how it is drawn, with a live preview. Choices the stats rules would block
	// are greyed out with the reason, so a card can't be saved in a state that lies.
	import { onDestroy, untrack } from 'svelte';
	import { blocked, set } from '$lib/rules/core';
	import { cardRules, checkCard } from '$lib/rules/stats';
	import type { CardResult } from '../engine';
	import { autoTitle, cardFields, perLogChoices, statCtx, type Catalog } from '../catalog';
	import {
		BUCKETS,
		CHARTS,
		OVER_TIME,
		RANGES,
		SHARE_MEASURES,
		SIZES,
		SOURCES,
		SPLITS,
		measureOf,
		perLogLabel,
		type BoardFilter,
		type CustomMeasure,
		type StatCard
	} from '../model';
	import Chart from './Chart.svelte';

	let {
		initial,
		catalog,
		measures,
		hidden,
		board,
		saving = false,
		live = false,
		problem = '',
		onsave,
		oncancel
	}: {
		initial: StatCard;
		catalog: Catalog;
		measures: CustomMeasure[];
		hidden: string[];
		board: { range: string; filter: BoardFilter };
		saving?: boolean;
		/** The settings of a card that is there: each change saves itself. */
		live?: boolean;
		/** Why the last one wasn't saved. */
		problem?: string;
		onsave: (card: StatCard) => unknown;
		oncancel: () => void;
	} = $props();

	let c = $state<StatCard>(structuredClone(untrack(() => $state.snapshot(initial))) as StatCard);
	const snap = () => $state.snapshot(c) as StatCard;
	const ctx = $derived(statCtx(c, catalog, { hidden, measures }));
	const issues = $derived(checkCard(c, ctx));
	const blocks = $derived(issues.filter((i) => i.severity === 'block'));
	const title = $derived(autoTitle(c, catalog, measures));

	/** Why picking `v` for `path` would be blocked (by a rule on `at`, not already broken), or null. */
	function optionIssue(path: string, v: unknown, at: string[] = [path]): string | null {
		const next = set(snap(), path, v);
		const now = new Set(blocks.map((b) => b.path + b.reason));
		const i = checkCard(next, statCtx(next, catalog, { hidden, measures })).find(
			(x) => x.severity === 'block' && at.includes(x.path) && !now.has(x.path + x.reason)
		);
		return i?.reason ?? null;
	}
	const why = (path: Parameters<typeof blocked<StatCard, typeof ctx>>[2]) => blocked(cardRules, c, path, ctx)?.reason ?? null;

	const choices = $derived(perLogChoices(c, catalog, measures));
	const SPLITS_BY_SOURCE: Record<string, string[]> = {
		outcomes: ['none', 'habit', 'area', 'variant', 'level', 'weekday', 'part'],
		field: ['none', 'habit', 'task', 'tag', 'area', 'variant', 'level', 'weekday', 'part', 'option', 'set', 'field'],
		task: ['none', 'habit', 'task', 'tag', 'area', 'variant', 'level', 'weekday', 'part'],
		slips: ['none', 'habit', 'area', 'weekday', 'part'],
		cravings: ['none', 'habit', 'area', 'weekday', 'part'],
		money: ['none', 'habit', 'area', 'weekday']
	};

	const defaultOver = (perLog: string) =>
		measureOf(perLog, measures)?.over ?? (SHARE_MEASURES.includes(perLog) || perLog === 'pctTarget'
			? 'avg'
			: perLog === 'best'
				? 'max'
				: perLog === 'option' || perLog === 'present'
					? 'count'
					: perLog === 'value' && cardFields(c, catalog)[0]?.type === 'number'
						? 'avg'
						: 'sum');

	function fitPerLog() {
		if (!choices.includes(c.perLog)) {
			c.perLog = choices[0] ?? 'done';
			c.overTime = defaultOver(c.perLog);
		}
		if (!SPLITS_BY_SOURCE[c.what.source].includes(c.split)) c.split = 'none';
	}
	function setSource(src: StatCard['what']['source']) {
		c.what = { source: src, metrics: [], name: null, taskId: null };
		c.compare.goalFromTargets = false;
		if (src === 'slips' || src === 'cravings') c.perLog = 'count';
		fitPerLog();
		if (c.look.chart === 'sessions' && !['field', 'task'].includes(src)) c.look.chart = 'tile';
		if (c.look.chart === 'streak' && !['outcomes', 'slips'].includes(src)) c.look.chart = 'tile';
	}
	function setPerLog(p: string) {
		c.perLog = p;
		c.overTime = defaultOver(p);
	}
	/** The card with another chart, and the choices that chart can't use put right. */
	function withChart(card: StatCard, ch: StatCard['look']['chart']): StatCard {
		const x = structuredClone(card);
		x.look.chart = ch;
		if (ch === 'tile' || ch === 'calendar') x.split = 'none';
		if (ch === 'calendar' && !['auto', 'day'].includes(x.bucket)) x.bucket = 'auto';
		if (ch === 'line' && x.bucket === 'all') x.bucket = 'auto';
		if (ch === 'breakdown' && x.split === 'none') x.split = x.what.source === 'field' && cardFields(x, catalog)[0]?.type === 'choice' ? 'option' : 'habit';
		if (ch !== 'bars') x.look.stacked = false;
		if (ch !== 'bars' && ch !== 'line') x.compare.rolling = 0;
		if (ch === 'tile' && x.look.size === 'full') x.look.size = 'small';
		return x;
	}
	const setChart = (ch: StatCard['look']['chart']) => (c = withChart(snap(), ch));
	function chartIssue(ch: StatCard['look']['chart']): string | null {
		const next = withChart(snap(), ch);
		return checkCard(next, statCtx(next, catalog, { hidden, measures })).find((x) => x.severity === 'block' && x.path === 'look.chart')?.reason ?? null;
	}

	// Fields grouped by Task, for the field picker.
	const byTask = $derived(
		catalog.tasks
			.map((t) => ({ t, ms: catalog.metrics.filter((m) => m.taskId === t.id) }))
			.filter((x) => x.ms.length)
	);
	const names = $derived([...new Set(catalog.metrics.map((m) => m.name))].sort((a, b) => a.localeCompare(b)));
	let rollup = $state(untrack(() => !!initial.what.name));
	function toggleMetric(id: string) {
		const has = c.what.metrics.includes(id);
		c.what.metrics = has ? c.what.metrics.filter((x) => x !== id) : [...c.what.metrics, id].slice(0, 10);
		c.what.name = null;
		fitPerLog();
		if (!choices.includes(c.perLog)) setPerLog(choices[0]);
	}
	function setRollup(on: boolean) {
		rollup = on;
		c.what.metrics = [];
		c.what.name = on ? (names[0] ?? null) : null;
		fitPerLog();
	}
	const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

	let since = $state(untrack(() => (initial.range.startsWith('since:') ? initial.range.slice(6) : '')));
	const rangeSel = $derived(c.range.startsWith('since:') ? 'since' : c.range);

	// Live preview, a moment after the last change.
	let preview = $state<CardResult | null>(null);
	let previewCard = $state<StatCard | null>(null);
	let loading = $state(false);
	let failed = $state<string | null>(null);
	$effect(() => {
		const card = snap();
		if (blocks.length) return;
		const t = setTimeout(async () => {
			loading = true;
			try {
				const res = await fetch('/api/stats', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ op: 'preview', card, ctx: board })
				});
				if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Could not work this card out');
				const j = await res.json();
				preview = j.result;
				previewCard = j.card;
				failed = null;
			} catch (e) {
				failed = (e as Error).message;
			} finally {
				loading = false;
			}
		}, 300);
		return () => clearTimeout(t);
	});

	function save() {
		const out = snap();
		out.title = out.title.trim() || title;
		return onsave(out);
	}
	let saved = untrack(() => JSON.stringify(snap()));
	/** Saves what changed, unless the rules block it. One that failed is sent again with the next change, or on the way out. */
	async function flush() {
		const now = JSON.stringify(snap());
		if (!live || now === saved || blocks.length) return;
		const was = saved;
		saved = now;
		if ((await save()) === false && saved === now) saved = was;
	}
	$effect(() => {
		void JSON.stringify(snap());
		const t = setTimeout(flush, 800);
		return () => clearTimeout(t);
	});
	onDestroy(() => void flush());
	const usesBucket = $derived(['bars', 'line', 'tile', 'goal'].includes(c.look.chart));
	const habits = $derived(catalog.habits.filter((h) => !h.archived || c.filter.habits.includes(h.id)));
</script>

<div class="builder">
	<section class="preview card" aria-live="polite">
		<h3>{c.title.trim() || title}</h3>
		<div class="muted small">Preview{loading ? ' · working it out…' : ''}</div>
		{#if blocks.length}
			<p class="muted">Fix the choices marked below to see the preview.</p>
		{:else if failed}
			<p class="error">{failed}</p>
		{:else if preview && previewCard}
			<div class:stale={loading}>
				{#if preview.empty}
					<p class="muted">Nothing logged in this range yet. The card fills in as you log.</p>
				{:else}
					<Chart card={previewCard} r={preview} rangeKey={c.range === 'page' ? board.range : c.range} />
				{/if}
				{#each preview.notes as n (n)}<p class="muted small">{n}</p>{/each}
			</div>
		{/if}
	</section>

	<div class="form stack">
		<label>
			Name
			<input bind:value={c.title} maxlength="60" placeholder={title} />
		</label>

		{#snippet pickFields()}
				<div class="row mode">
					<label class="inline"><input type="radio" checked={!rollup} onchange={() => setRollup(false)} /> Pick fields</label>
					<label class="inline"><input type="radio" checked={rollup} onchange={() => setRollup(true)} /> Every field called…</label>
				</div>
				{#if rollup}
					<label>
						Field name
						<select value={c.what.name ?? ''} onchange={(e) => ((c.what.name = (e.currentTarget as HTMLSelectElement).value), fitPerLog())}>
							{#each names as n (n)}<option value={n}>{n}</option>{/each}
						</select>
					</label>
					<p class="muted small">Adds up every field with this name across your Tasks, in one unit. Fields in a unit that can't be converted are left out, with a note.</p>
				{:else}
					<div class="fields">
						{#each byTask as g (g.t.id)}
							<div class="group">
								<div class="muted small">{g.t.name}</div>
								<div class="chips">
									{#each g.ms as m (m.id)}
										<button type="button" class="toggle" aria-pressed={c.what.metrics.includes(m.id)} onclick={() => toggleMetric(m.id)}>
											{m.name}{m.unit ? ` (${m.unit})` : ''}{m.repeats ? ' · per set' : ''}
										</button>
									{/each}
								</div>
							</div>
						{:else}
							<p class="muted">No Task has fields yet.</p>
						{/each}
					</div>
				{/if}
		{/snippet}

		{#if live}
			<p class="meta muted">What it counts, what it is about, its range and how it is drawn are in the card's sentence and its ⋯.</p>
			{#if c.what.source === 'field'}
				<details open={rollup || c.what.metrics.length > 1}>
					<summary>Several fields</summary>
					<div class="stack inner">{@render pickFields()}</div>
				</details>
			{/if}
		{:else}
		<fieldset>
			<legend>What it reads</legend>
			<div class="chips">
				{#each Object.entries(SOURCES) as [k, label] (k)}
					<button type="button" class="toggle" aria-pressed={c.what.source === k} onclick={() => setSource(k as StatCard['what']['source'])}>{label}</button>
				{/each}
			</div>
			{#if c.what.source === 'field'}
				{@render pickFields()}
			{:else if c.what.source === 'task'}
				<label>
					Task
					<select value={c.what.taskId ?? ''} onchange={(e) => ((c.what.taskId = (e.currentTarget as HTMLSelectElement).value || null), fitPerLog())}>
						<option value="">Every Task</option>
						{#each catalog.tasks as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
					</select>
				</label>
			{/if}
		</fieldset>
		{/if}

		<div class="grid2">
			{#if !live}<label>
				Each log counts as
				<select value={c.perLog} onchange={(e) => setPerLog((e.currentTarget as HTMLSelectElement).value)}>
					{#each choices as p (p)}
						{@const bad = optionIssue('perLog', p)}
						<option value={p} disabled={!!bad}>{perLogLabel(p, measures)}{bad ? ' (not available)' : ''}</option>
					{/each}
				</select>
			</label>{/if}
			<label>
				Over time, take the
				<select bind:value={c.overTime}>
					{#each Object.entries(OVER_TIME) as [k, label] (k)}
						{@const bad = optionIssue('overTime', k)}
						<option value={k} disabled={!!bad}>{label}</option>
					{/each}
				</select>
			</label>
		</div>

		{#if !live}
		<fieldset>
			<legend>Card type</legend>
			<div class="chips">
				{#each Object.entries(CHARTS).filter(([k]) => c.look.chart === k || !chartIssue(k as StatCard['look']['chart'])) as [k, label] (k)}
					<button type="button" class="toggle" aria-pressed={c.look.chart === k} onclick={() => setChart(k as StatCard['look']['chart'])}>{label}</button>
				{/each}
			</div>
		</fieldset>
		{/if}

		<div class="grid2">
			{#if usesBucket && !(live && ['bars', 'line'].includes(c.look.chart))}
				<label>
					{c.look.chart === 'tile' ? 'Trend in steps of' : c.look.chart === 'goal' ? 'Goal per' : 'One bar or point per'}
					<select bind:value={c.bucket}>
						{#each Object.entries(BUCKETS) as [k, label] (k)}
							{@const bad = optionIssue('bucket', k, ['bucket', 'look.chart'])}
							<option value={k} disabled={!!bad && c.bucket !== k}>{label}</option>
						{/each}
					</select>
				</label>
			{/if}
			<label>
				Split into one series per
				<select bind:value={() => (c.split === 'tag' && c.grouping ? `tag:${c.grouping}` : c.split), (v) => ((c.split = v.split(':')[0] as typeof c.split), (c.grouping = v.startsWith('tag:') ? v.slice(4) : undefined))}>
					{#each SPLITS_BY_SOURCE[c.what.source] as k (k)}
						{@const bad = optionIssue('split', k, ['split', 'look.chart', 'look.stacked'])}
						<option value={k} disabled={!!bad && c.split !== k}>{k !== 'tag' ? SPLITS[k as keyof typeof SPLITS] : catalog.groupings.length > 1 ? 'Every grouping' : (catalog.groupings[0]?.name ?? SPLITS.tag)}</option>
						{#if k === 'tag' && catalog.groupings.length > 1}{#each catalog.groupings as g (g.id)}<option value="tag:{g.id}" disabled={!!bad && c.split !== k}>{g.name}</option>{/each}{/if}
					{/each}
				</select>
			</label>
		</div>

		{#if live}
			<label class="since">Since a date, in place of a range <input type="date" value={since} onchange={(e) => ((since = e.currentTarget.value), (c.range = since ? `since:${since}` : 'page'))} /></label>
		{:else}
		<div class="grid2">
			<label>
				Range
				<select
					value={rangeSel}
					onchange={(e) => {
						const v = (e.currentTarget as HTMLSelectElement).value;
						c.range = v === 'since' ? `since:${since || new Date().toISOString().slice(0, 10)}` : v;
					}}
				>
					<option value="page">Same as the board</option>
					{#each Object.entries(RANGES) as [k, label] (k)}<option value={k}>{label}</option>{/each}
					<option value="since">Since a date…</option>
				</select>
			</label>
			{#if rangeSel === 'since'}
				<label>
					Since
					<input type="date" bind:value={since} onchange={() => (c.range = `since:${since}`)} />
				</label>
			{/if}
		</div>
		{/if}

		<details>
			<summary>Only some habits, tags or Areas{c.filter.habits.length + c.filter.tags.length + c.filter.areas.length ? ` (${c.filter.habits.length + c.filter.tags.length + c.filter.areas.length})` : ''}</summary>
			<div class="stack inner">
				<div>
					<div class="muted small">Habits</div>
					<div class="chips">
						{#each habits as h (h.id)}
							<button type="button" class="toggle" aria-pressed={c.filter.habits.includes(h.id)} onclick={() => (c.filter.habits = toggle(c.filter.habits, h.id))}>{h.name}{h.archived ? ' (archived)' : ''}</button>
						{/each}
					</div>
				</div>
				{#if catalog.tags.length}
					<div>
						<div class="muted small">Tags</div>
						<div class="chips">
							{#each catalog.tags as t (t)}
								<button type="button" class="toggle" aria-pressed={c.filter.tags.includes(t)} onclick={() => (c.filter.tags = toggle(c.filter.tags, t))}>{t}</button>
							{/each}
						</div>
					</div>
				{/if}
				{#if catalog.areas.length}
					<div>
						<div class="muted small">Areas</div>
						<div class="chips">
							{#each catalog.areas as a (a.id)}
								<button type="button" class="toggle" aria-pressed={c.filter.areas.includes(a.id)} onclick={() => (c.filter.areas = toggle(c.filter.areas, a.id))}>{a.icon} {a.name}</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</details>

		<details open={c.compare.previous || c.compare.goal !== null || c.compare.goalFromTargets || c.compare.running || c.compare.rolling !== 0}>
			<summary>Compare and goals</summary>
			<div class="stack inner">
				<label class="inline"><input type="checkbox" bind:checked={c.compare.previous} /> Compare with the period before</label>
				<div class="grid2">
					<label>
						Goal
						<input
							type="number"
							step="any"
							value={c.compare.goal ?? ''}
							disabled={!!why('compare.goal')}
							oninput={(e) => {
								const v = (e.currentTarget as HTMLInputElement).value;
								c.compare.goal = v === '' ? null : Number(v);
								if (c.compare.goal === null) c.compare.goalMax = null;
							}}
						/>
					</label>
					<label>
						Top of a goal band
						<input
							type="number"
							step="any"
							value={c.compare.goalMax ?? ''}
							disabled={!!why('compare.goalMax')}
							oninput={(e) => {
								const v = (e.currentTarget as HTMLInputElement).value;
								c.compare.goalMax = v === '' ? null : Number(v);
							}}
						/>
					</label>
				</div>
				{#each [...new Set([why('compare.goal'), c.compare.goal === null ? null : why('compare.goalMax')])].filter(Boolean) as reason (reason)}<p class="muted small">{reason}</p>{/each}
				{#if c.what.source === 'field'}
					<label class="inline">
						<input type="checkbox" bind:checked={c.compare.goalFromTargets} disabled={!!why('compare.goalFromTargets')} /> Take the goal from the targets
					</label>
					{#if why('compare.goalFromTargets')}<p class="muted small">{why('compare.goalFromTargets')}</p>{/if}
				{/if}
				<label class="inline" class:off={!!why('compare.running')}>
					<input type="checkbox" bind:checked={c.compare.running} disabled={!!why('compare.running')} /> Running total
				</label>
				{#if why('compare.running')}<p class="muted small">{why('compare.running')}</p>{/if}
				<label>
					Rolling average
					<select bind:value={c.compare.rolling} disabled={!!why('compare.rolling')}>
						<option value={0}>None</option>
						<option value={7}>7 days</option>
						<option value={30}>30 days</option>
					</select>
				</label>
				{#if why('compare.rolling')}<p class="muted small">{why('compare.rolling')}</p>{/if}
			</div>
		</details>

		<details>
			<summary>Look</summary>
			<div class="stack inner">
				<div class="grid2">
					{#if !live}<label>
						Size
						<select bind:value={c.look.size}>
							{#each Object.entries(SIZES) as [k, label] (k)}<option value={k}>{label}</option>{/each}
						</select>
					</label>{/if}
					<label>
						{c.look.chart === 'sessions' ? 'Sessions shown' : 'Series shown before the rest become Other'}
						<input type="number" min="1" max="20" bind:value={c.look.top} />
					</label>
				</div>
				{#if c.look.chart === 'bars'}
					<label class="inline">
						<input type="checkbox" bind:checked={c.look.stacked} disabled={!c.look.stacked && !!optionIssue('look.stacked', true)} /> Stack the series
					</label>
					{#if !c.look.stacked && optionIssue('look.stacked', true)}<p class="muted small">{optionIssue('look.stacked', true)}</p>{/if}
				{/if}
			</div>
		</details>

		{#if issues.length}
			<ul class="issues">
				{#each issues as i (i.path + i.reason)}
					<li class:error={i.severity === 'block'} class:muted={i.severity === 'warn'}>{i.reason}</li>
				{/each}
			</ul>
		{/if}

		{#if live}
			<p class="meta" role="status">{blocks.length ? 'This isn’t saved until it is put right.' : problem ? `Not saved. ${problem}` : ''}</p>
			<div class="actions"><button type="button" onclick={oncancel}>Close</button></div>
		{:else}
			<div class="actions">
				<button type="button" onclick={oncancel}>Cancel</button>
				<button type="button" class="primary" disabled={!!blocks.length || saving} onclick={save}>{saving ? 'Saving…' : 'Save card'}</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.since > input {
		width: auto;
	}
	.builder {
		display: grid;
		/* A wide chart scrolls in its box; it never widens the form. */
		grid-template-columns: minmax(0, 1fr);
		gap: 1rem;
	}
	@media (min-width: 900px) {
		.builder {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			align-items: start;
		}
		.preview {
			position: sticky;
			top: 1rem;
		}
	}
	.preview h3 {
		margin: 0;
		font-size: var(--font-size-card-title);
	}
	.preview > div:nth-child(2) {
		margin-bottom: 0.6rem;
	}
	.stale {
		opacity: 0.55;
		transition: opacity 0.2s;
	}
	fieldset {
		border: none;
		padding: 0;
		margin: 0;
	}
	legend {
		font-size: var(--font-size-label);
		color: var(--ink-muted);
		padding: 0;
		margin-bottom: 0.1rem;
	}
	.grid2 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.6rem;
	}
	.inline {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		color: var(--ink);
	}
	.inline.off {
		color: var(--ink-muted);
	}
	.mode {
		margin: 0.5rem 0 0.25rem;
		gap: 1rem;
	}
	.fields {
		max-height: 16rem;
		overflow: auto;
		margin-top: 0.4rem;
	}
	.group + .group {
		margin-top: 0.5rem;
	}
	details summary {
		cursor: pointer;
		color: var(--accent);
		font-size: var(--font-size-label);
	}
	.inner {
		margin-top: 0.6rem;
	}
	.small {
		font-size: var(--font-size-chip);
	}
	.issues {
		margin: 0;
		padding-left: 1.1rem;
		font-size: var(--font-size-meta);
	}
	.actions {
		margin-top: 0.5rem;
	}
</style>
