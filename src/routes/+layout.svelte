<script lang="ts">
	/**
	 * Global chrome. The login route renders bare; every other route gets the
	 * top bar plus tab navigation.
	 */
	import { page } from '$app/state';
	import '../app.css';
	import ToastHost from '$lib/components/ToastHost.svelte';
	import AppShell from '$lib/components/AppShell.svelte';
	import { auth } from '$lib/stores/auth.svelte';

	let { children } = $props();

	// Restore the session once, before any guarded page renders.
	$effect(() => {
		void auth.restore();
	});

	const isLogin = $derived(page.url.pathname.replace(/\/+$/, '') === '/login');
</script>

{#if isLogin}
	{@render children()}
{:else}
	<AppShell>
		{@render children()}
	</AppShell>
{/if}

<ToastHost />
