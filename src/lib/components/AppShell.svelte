<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$lib/api/client';
	import { auth } from '$lib/stores/auth.svelte';
	import { feedback } from '$lib/stores/feedback.svelte';

	let { children } = $props();

	const navItems = [
		{ path: '/users', label: '用户管理' },
		{ path: '/projects', label: '项目管理' },
		{ path: '/assign', label: '权限分配' },
		{ path: '/logs', label: '历史日志' },
		{ path: '/plugins', label: '插件与统计' }
	];

	let online = $state<number | null>(null);

	async function refreshStatus() {
		try {
			const status = await api.status();
			online = status.online_count;
		} catch {
			online = null;
		}
	}

	$effect(() => {
		void refreshStatus();
		const timer = setInterval(() => void refreshStatus(), 15000);
		return () => clearInterval(timer);
	});

	// Guard every shell-rendered page: no session -> back to login.
	$effect(() => {
		if (!auth.loading && !auth.user) {
			goto('/login', { replaceState: true });
		}
	});

	const current = $derived(page.url.pathname.replace(/\/+$/, '') || '/users');
	const displayName = $derived(auth.user?.display_name || auth.user?.username || '');

	function logout() {
		auth.logout();
		feedback.info('已退出登录');
		void goto('/login', { replaceState: true });
	}
</script>

<div class="min-h-screen bg-bg-base text-text-dark">
	<header
		class="sticky top-0 z-50 flex items-center justify-between gap-4 border-b border-white/5 bg-bg-surface/95 px-4 py-3 backdrop-blur md:px-7"
	>
		<div class="flex items-center gap-3">
			<span class="h-2.5 w-2.5 rounded-full bg-primary"></span>
			<div>
				<h1 class="text-base leading-tight font-semibold tracking-wide text-text-dark">管理后台</h1>
				<p class="text-[11px] leading-tight text-gray-500">校园直播导播协调系统</p>
			</div>
		</div>

		<div class="flex items-center gap-3 text-xs md:gap-5">
			<span class="hidden items-center gap-1.5 sm:inline-flex">
				{#if online === null}
					<span class="h-2 w-2 rounded-full bg-gray-600"></span>
					<span class="text-gray-500">离线</span>
				{:else}
					<span class="h-2 w-2 rounded-full bg-success"></span>
					<span class="text-gray-400">在线 {online}</span>
				{/if}
			</span>

			{#if auth.user}
				<span class="hidden text-gray-400 md:inline">{displayName}</span>
				{#if auth.isAdmin}
					<span class="hidden text-[11px] tracking-wide text-primary uppercase md:inline">管理员</span>
				{/if}
			{/if}

			<button
				type="button"
				onclick={logout}
				class="cursor-pointer rounded-[var(--radius-small)] border border-white/10 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-primary hover:text-primary"
			>
				退出登录
			</button>
		</div>
	</header>

	<div class="mx-auto w-full max-w-6xl px-4 py-5 md:px-6">
		<nav
			class="mb-5 flex gap-1 overflow-x-auto rounded-[var(--radius-box)] border border-white/5 bg-bg-surface p-1"
		>
			{#each navItems as item (item.path)}
				<a
					href={`${item.path}`}
					class="flex-1 rounded-[var(--radius-small)] px-4 py-2.5 text-center text-[13px] font-medium whitespace-nowrap transition-colors {current ===
					item.path
						? 'bg-bg-highlight text-primary'
						: 'text-gray-500 hover:bg-white/5 hover:text-gray-300'}"
				>
					{item.label}
				</a>
			{/each}
		</nav>

		{@render children()}
	</div>
</div>
