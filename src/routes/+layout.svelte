<script lang="ts">
	/**
	 * Global chrome. The login and setup routes render bare; every other route
	 * gets the top bar plus tab navigation.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import '../app.css';
	import ToastHost from '$lib/components/ToastHost.svelte';
	import AppShell from '$lib/components/AppShell.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { setup } from '$lib/stores/setup.svelte';

	let { children } = $props();

	// Restore the session once, before any guarded page renders.
	$effect(() => {
		void auth.restore();
	});

	// 全新部署时后端只会放行初始化接口，其余页面拿不到任何数据。这里在首屏
	// 问一次状态，把用户直接送到 /setup，而不是让每个页面各自弹一串请求失败。
	onMount(() => {
		void setup.check().then(() => setup.guard(page.url.pathname));
	});

	const path = $derived(page.url.pathname.replace(/\/+$/, ''));
	const isLogin = $derived(path === resolve('/login'));
	const isSetup = $derived(path === resolve('/setup'));
</script>

{#if isLogin || isSetup}
	{@render children()}
{:else}
	<AppShell>
		{@render children()}
	</AppShell>
{/if}

<ToastHost />
