<script lang="ts">
	import { PAST_DAYS_CHOICES } from '$lib/engine/backfill';

	let { data } = $props();

	const shortDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
	const list = (xs: string[], max = 3) => (xs.length > max ? `${xs.slice(0, max).join(', ')} and ${xs.length - max} more` : xs.join(', '));
	const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

	const day = $derived(
		[
			data.dayStart && data.dayStart !== '00:00' ? `Starts at ${data.dayStart}` : 'Starts at midnight',
			data.ranges.length ? list(data.ranges) : 'no parts of the day yet'
		].join(' · ')
	);
	const pastDays = $derived(
		[
			PAST_DAYS_CHOICES.find((c) => c.value === data.pastDays)?.label ?? `Up to ${plural(data.pastDays ?? 0, 'day')} back`,
			data.pastDays !== 0 ? (data.nudgeYesterday ? 'reminds you about yesterday' : 'no reminder') : null
		]
			.filter(Boolean)
			.join(' · ')
	);
	const vacation = $derived.by(() => {
		const v = data.vacation;
		if (!v) return 'None planned';
		const when = v.start <= data.today ? `On vacation until ${shortDate(v.end)}` : `${shortDate(v.start)} to ${shortDate(v.end)}`;
		return data.moreVacations ? `${when}, and ${plural(data.moreVacations, 'more')}` : when;
	});
	const views = $derived(
		`${data.template} · opens on ${data.startPage}${data.viewWarnings ? ` · ${plural(data.viewWarnings, 'thing', 'things')} to check` : ''}`
	);
	const features = $derived(data.hidden ? `${data.features - data.hidden} of ${data.features} in use` : 'All in use');
	const editor = $derived(
		[
			data.guidedSetup ? 'Guided setup for new habits' : 'New habits open the full editor',
			data.showAllSections ? 'every section shown' : null,
			`weights in ${data.weightUnit}`
		]
			.filter(Boolean)
			.join(' · ')
	);
	const reminders = $derived(data.devices ? `On for ${plural(data.devices, 'device')}` : 'Off on every device');
</script>

<svelte:head><title>Settings · ittracks</title></svelte:head>

<header class="bar">
	<h1>Settings</h1>
</header>

{#snippet row(href: string, title: string, line: string)}
	<li>
		<a class="card" {href}>
			<div class="setting">
				<div class="grow">
					<strong>{title}</strong>
					<div class="muted small-text">{line}</div>
				</div>
				<span class="muted" aria-hidden="true">›</span>
			</div>
		</a>
	</li>
{/snippet}

<h2>Your day</h2>
<ul class="list">
	{@render row('/settings/day', 'Day and parts of the day', day)}
	{@render row('/settings/vacation', 'Vacation', vacation)}
	{@render row('/settings/past-days', 'Logging past days', pastDays)}
	{@render row('/settings/journal', 'Journal', data.journalOff ? 'Switched off in Features' : data.dayNote ? 'Day note on Today · Markdown export' : 'No day note · Markdown export')}
</ul>

<h2>Habits and Tasks</h2>
<ul class="list">
	<p class="muted small-text">Areas: group <a href="/habits">Habits</a> or the <a href="/library">Library</a> by Area, then choose Edit.</p>
	{@render row('/settings/editor', 'New habits and units', editor)}
</ul>

<h2>Look and layout</h2>
<ul class="list">
	{@render row('/settings/views', 'View template and start page', views)}
	{@render row('/settings/features', 'Features', features)}
</ul>

<h2>Stats</h2>
<ul class="list">
	{@render row(
		'/settings/stats',
		'Your measures and formulas',
		`${data.stats.measures ? plural(data.stats.measures, 'measure') : 'No measures of your own yet'} · e1RM by ${data.stats.e1rm}`
	)}
</ul>

<h2>Notifications</h2>
<ul class="list">
	{@render row('/settings/reminders', 'Reminders', reminders)}
</ul>

<h2>Data</h2>
<ul class="list">
	{@render row('/settings/data', 'Export, import and templates', 'Back up or analyse your data, restore it, share habits')}
	{@render row(
		'/settings/integrations',
		'Integrations',
		`${data.keys ? plural(data.keys, 'key') : 'No keys'} · Shortcuts, quick-log links, AI assistants`
	)}
</ul>

<h2>Account</h2>
<ul class="list">
	{@render row('/settings/account', 'Account and password', `Signed in as ${data.username}`)}
</ul>

<form method="POST" action="/logout" style="margin-top: 1.5rem"><button class="danger">Log out</button></form>

<style>
	.setting {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	.small-text {
		font-size: 0.85rem;
	}
</style>
