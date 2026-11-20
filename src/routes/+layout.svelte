<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	// Tell the server the browser's time zone, so "today" matches the user's calendar.
	$effect(() => {
		const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (!document.cookie.includes(`tz=${encodeURIComponent(tz)}`)) {
			document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
			// Reload once so the page is computed for the right day; never loop if cookies are blocked.
			try {
				if (document.cookie.includes('tz=') && !sessionStorage.getItem('tz-set')) {
					sessionStorage.setItem('tz-set', '1');
					location.reload();
				}
			} catch {
				// Storage blocked: skip the reload; the next visit picks up the cookie.
			}
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
