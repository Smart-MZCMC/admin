<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { api } from '$lib/api/client';
	import { auth } from '$lib/stores/auth.svelte';
	import { feedback } from '$lib/stores/feedback.svelte';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';

	let { children } = $props();

	/** Typed so `resolve()` accepts these without a cast. */
	type NavPath = '/' | '/users' | '/projects' | '/assign' | '/logs' | '/plugins';

	const navGroups: { label: string; items: { path: NavPath; label: string; icon: IconName }[] }[] =
		[
			{
				label: '工作空间',
				items: [
					{ path: '/', label: '总览', icon: 'overview' },
					{ path: '/users', label: '用户管理', icon: 'users' },
					{ path: '/projects', label: '项目管理', icon: 'projects' },
					{ path: '/assign', label: '权限分配', icon: 'assign' }
				]
			},
			{
				label: '系统',
				items: [
					{ path: '/logs', label: '日志审计', icon: 'logs' },
					{ path: '/plugins', label: '插件与统计', icon: 'plugins' }
				]
			}
		];

	const flatNav = navGroups.flatMap((group) => group.items);

	interface SearchItem {
		id: string;
		label: string;
		meta: string;
		href: NavPath;
		group: '用户' | '项目';
	}

	let online = $state<number | null>(null);
	let version = $state('');
	let drawerOpen = $state(false);
	let userMenuOpen = $state(false);
	let searchOpen = $state(false);
	let query = $state('');
	let activeResult = $state(0);
	let searchBox = $state<HTMLInputElement | null>(null);
	let index = $state<SearchItem[]>([]);
	let indexReady = $state(false);

	/** Strip the trailing slash so `resolve('/')` and the live URL compare equal. */
	function normalise(value: string): string {
		return value.replace(/\/+$/, '');
	}

	const current = $derived(normalise(page.url.pathname));
	const currentLabel = $derived(
		flatNav.find((item) => normalise(resolve(item.path)) === current)?.label ?? '总览'
	);
	const displayName = $derived(auth.user?.display_name || auth.user?.username || '管理员');
	const initials = $derived(displayName.slice(0, 1).toUpperCase());

	async function refreshStatus() {
		try {
			const status = await api.status();
			online = status.online_count;
			version = status.version;
		} catch {
			online = null;
		}
	}

	/** Users and projects power the quick jump; a failure just empties the list. */
	async function loadIndex() {
		try {
			const [users, projects] = await Promise.all([api.listUsers(), api.listProjects()]);
			index = [
				...users.map((user) => ({
					id: `user-${user.id}`,
					label: user.display_name || user.username,
					meta: `@${user.username} · ${user.role === 'admin' ? '管理员' : '导播'}`,
					href: '/users' as const,
					group: '用户' as const
				})),
				...projects.map((project) => ({
					id: `project-${project.id}`,
					label: project.name,
					meta: project.code,
					href: '/projects' as const,
					group: '项目' as const
				}))
			];
		} catch {
			index = [];
		} finally {
			indexReady = true;
		}
	}

	const results = $derived(
		query.trim().length === 0
			? []
			: index
					.filter((item) => {
						const needle = query.trim().toLowerCase();
						return (
							item.label.toLowerCase().includes(needle) || item.meta.toLowerCase().includes(needle)
						);
					})
					.slice(0, 8)
	);

	$effect(() => {
		void refreshStatus();
		const timer = setInterval(() => void refreshStatus(), 15000);
		return () => clearInterval(timer);
	});

	// Guard every shell-rendered page, then build the search index once.
	$effect(() => {
		if (auth.loading) return;
		if (!auth.user) {
			void goto(resolve('/login'), { replaceState: true });
			return;
		}
		if (!indexReady) void loadIndex();
	});

	$effect(() => {
		activeResult = 0;
	});

	// Cmd/Ctrl+K focuses the quick jump from anywhere in the shell.
	$effect(() => {
		function onKeydown(event: KeyboardEvent) {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault();
				searchBox?.focus();
				searchOpen = true;
			}
		}
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	function go(path: NavPath) {
		query = '';
		searchOpen = false;
		drawerOpen = false;
		userMenuOpen = false;
		void goto(resolve(path));
	}

	function logout() {
		auth.logout();
		feedback.info('已退出登录');
		void goto(resolve('/login'), { replaceState: true });
	}

	function onSearchKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			searchOpen = false;
			searchBox?.blur();
			return;
		}
		if (results.length === 0) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			activeResult = (activeResult + 1) % results.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			activeResult = (activeResult - 1 + results.length) % results.length;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			go(results[activeResult].href);
		}
	}
</script>

<div class="min-h-screen bg-bg-base text-fg">
	{#if drawerOpen}
		<button
			type="button"
			aria-label="关闭导航"
			class="fixed inset-0 z-40 bg-slate-900/30 lg:hidden"
			onclick={() => (drawerOpen = false)}
		></button>
	{/if}

	<aside
		class="fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-border bg-bg-surface transition-transform duration-200 {drawerOpen
			? 'translate-x-0'
			: '-translate-x-full'} lg:translate-x-0"
	>
		<a
			href={resolve('/')}
			onclick={(event) => {
				event.preventDefault();
				go('/');
			}}
			class="flex h-[62px] shrink-0 items-center gap-3 border-b border-border px-5 no-underline"
		>
			<span
				class="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm"
			>
				<Icon name="overview" size={17} strokeWidth={1.9} />
			</span>
			<span class="min-w-0">
				<span class="block truncate text-[13.5px] font-semibold tracking-[-0.01em] text-fg"
					>融媒运营中心</span
				>
				<span class="mt-0.5 block truncate text-[10.5px] text-fg-muted">校园直播管理平台</span>
			</span>
		</a>

		<nav class="flex-1 overflow-y-auto px-3 py-4">
			{#each navGroups as group (group.label)}
				<div class="mb-5 last:mb-0">
					<div
						class="mb-1.5 px-2.5 text-[10px] font-semibold tracking-[0.14em] text-fg-faint uppercase"
					>
						{group.label}
					</div>
					<ul class="space-y-0.5">
						{#each group.items as item (item.path)}
							{@const active = normalise(resolve(item.path)) === current}
							<li>
								<a
									href={resolve(item.path)}
									onclick={(event) => {
										event.preventDefault();
										go(item.path);
									}}
									aria-current={active ? 'page' : undefined}
									class="group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[12.5px] font-medium no-underline transition-colors {active
										? 'bg-bg-highlight text-primary-ink'
										: 'text-fg-muted hover:bg-bg-hover hover:text-fg'}"
								>
									{#if active}
										<span
											class="absolute top-1/2 -left-3 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
										></span>
									{/if}
									<Icon
										name={item.icon}
										size={16}
										strokeWidth={active ? 1.9 : 1.7}
										class={active ? 'text-primary-ink' : 'text-fg-faint group-hover:text-fg-muted'}
									/>
									<span>{item.label}</span>
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</nav>

		<div class="shrink-0 border-t border-border px-3 py-3">
			<div class="flex items-center gap-2 px-1.5 pb-2.5">
				<span class="relative flex h-2 w-2 shrink-0">
					{#if online !== null}
						<span
							class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50"
						></span>
					{/if}
					<span
						class="relative inline-flex h-2 w-2 rounded-full {online === null
							? 'bg-border-strong'
							: 'bg-success'}"
					></span>
				</span>
				<span class="truncate text-[11px] text-fg-muted">
					{online === null ? '服务未连接' : `在线客户端 ${online}`}
				</span>
				{#if version}
					<span class="ml-auto shrink-0 font-mono text-[10px] text-fg-faint">v{version}</span>
				{/if}
			</div>

			<div
				class="flex items-center gap-2.5 rounded-lg border border-border bg-bg-overlay/70 px-2.5 py-2"
			>
				<span
					class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-[11px] font-semibold text-white"
				>
					{initials}
				</span>
				<span class="min-w-0 flex-1">
					<span class="block truncate text-[12px] font-medium text-fg">{displayName}</span>
					<span class="mt-0.5 block text-[10.5px] text-fg-muted">
						{auth.isAdmin ? '系统管理员' : '运营成员'}
					</span>
				</span>
				<button
					type="button"
					title="退出登录"
					aria-label="退出登录"
					onclick={logout}
					class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-bg-surface hover:text-fg"
				>
					<Icon name="logout" size={15} />
				</button>
			</div>
		</div>
	</aside>

	<div class="flex min-h-screen flex-col lg:pl-[248px]">
		<header
			class="sticky top-0 z-30 flex h-[62px] shrink-0 items-center gap-3 border-b border-border bg-bg-surface/90 px-4 backdrop-blur md:px-6"
		>
			<button
				type="button"
				aria-label="打开导航"
				onclick={() => (drawerOpen = true)}
				class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-hover lg:hidden"
			>
				<Icon name="menu" size={18} />
			</button>

			<div class="relative w-full max-w-[420px]">
				<Icon
					name="search"
					size={16}
					class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-faint"
				/>
				<input
					bind:this={searchBox}
					bind:value={query}
					onfocus={() => (searchOpen = true)}
					onkeydown={onSearchKeydown}
					oninput={() => (searchOpen = true)}
					placeholder="搜索用户、项目…"
					aria-label="全局搜索"
					class="h-9 w-full rounded-[var(--radius-form)] border border-border bg-bg-overlay pr-16 pl-9 text-[12.5px] text-fg transition-colors placeholder:text-fg-faint hover:border-border-strong focus:border-primary focus:bg-bg-surface focus:ring-2 focus:ring-primary/15 focus:outline-none"
				/>
				<kbd
					class="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border border-border bg-bg-surface px-1.5 py-0.5 font-sans text-[10px] text-fg-faint"
				>
					⌘K
				</kbd>

				{#if searchOpen && query.trim().length > 0}
					<button
						type="button"
						tabindex="-1"
						aria-label="关闭搜索结果"
						class="fixed inset-0 z-40 cursor-default"
						onclick={() => (searchOpen = false)}
					></button>
					<div
						class="absolute top-11 right-0 left-0 z-50 overflow-hidden rounded-[var(--radius-box)] border border-border bg-bg-elevated shadow-popover"
					>
						{#if results.length === 0}
							<p class="px-3.5 py-3 text-[12px] text-fg-muted">
								{indexReady ? '没有匹配的用户或项目' : '正在加载可搜索数据…'}
							</p>
						{:else}
							<ul class="max-h-80 overflow-y-auto p-1">
								{#each results as item, i (item.id)}
									<li>
										<button
											type="button"
											onmouseenter={() => (activeResult = i)}
											onclick={() => go(item.href)}
											class="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors {i ===
											activeResult
												? 'bg-bg-highlight'
												: 'hover:bg-bg-hover'}"
										>
											<Icon
												name={item.group === '用户' ? 'users' : 'projects'}
												size={15}
												class="shrink-0 text-fg-faint"
											/>
											<span class="min-w-0 flex-1">
												<span class="block truncate text-[12.5px] text-fg">{item.label}</span>
												<span class="block truncate text-[11px] text-fg-faint">{item.meta}</span>
											</span>
											<span
												class="shrink-0 rounded-full bg-bg-overlay px-1.5 py-0.5 text-[10px] text-fg-muted"
											>
												{item.group}
											</span>
										</button>
									</li>
								{/each}
							</ul>
							<div
								class="border-t border-border bg-bg-overlay/60 px-3 py-1.5 text-[10.5px] text-fg-faint"
							>
								↑↓ 选择 · ↵ 打开 · Esc 关闭
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<div class="ml-auto flex shrink-0 items-center gap-1.5">
				<div class="relative">
					<button
						type="button"
						title="系统状态"
						aria-label="系统状态"
						onclick={() => (userMenuOpen = false)}
						class="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
					>
						<Icon name="bell" size={17} />
						<span
							class="absolute top-2 right-2.5 h-1.5 w-1.5 rounded-full {online === null
								? 'bg-warning'
								: 'bg-success'}"
						></span>
					</button>
				</div>

				<div class="mx-1 hidden h-5 border-l border-border sm:block"></div>

				<div class="relative">
					<button
						type="button"
						onclick={() => (userMenuOpen = !userMenuOpen)}
						aria-haspopup="menu"
						aria-expanded={userMenuOpen}
						class="flex cursor-pointer items-center gap-2 rounded-md py-1 pr-1 pl-1.5 transition-colors hover:bg-bg-hover"
					>
						<span class="hidden text-right sm:block">
							<span class="block max-w-32 truncate text-[11.5px] font-medium text-fg"
								>{displayName}</span
							>
							<span class="block text-[10px] text-fg-faint">
								{auth.isAdmin ? '管理员' : '成员'}
							</span>
						</span>
						<span
							class="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-[11px] font-semibold text-white"
						>
							{initials}
						</span>
						<Icon name="chevron-down" size={14} class="hidden text-fg-faint sm:block" />
					</button>

					{#if userMenuOpen}
						<button
							type="button"
							tabindex="-1"
							aria-label="关闭用户菜单"
							class="fixed inset-0 z-40 cursor-default"
							onclick={() => (userMenuOpen = false)}
						></button>
						<div
							class="absolute top-11 right-0 z-50 w-52 overflow-hidden rounded-[var(--radius-box)] border border-border bg-bg-elevated shadow-popover"
						>
							<div class="border-b border-border px-3.5 py-3">
								<div class="truncate text-[12.5px] font-medium text-fg">{displayName}</div>
								<div class="mt-0.5 truncate text-[11px] text-fg-faint">
									{auth.user?.username ? `@${auth.user.username}` : '当前登录账户'}
								</div>
							</div>
							<div class="p-1">
								<button
									type="button"
									onclick={logout}
									class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] text-fg-muted transition-colors hover:bg-error-soft hover:text-error-ink"
								>
									<Icon name="logout" size={15} />
									退出登录
								</button>
							</div>
						</div>
					{/if}
				</div>
			</div>
		</header>

		<main class="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-6 md:py-7">
			<nav class="mb-4 flex items-center gap-1.5 text-[11px] text-fg-faint" aria-label="面包屑">
				<span>运营中心</span>
				<span aria-hidden="true">/</span>
				<span class="font-medium text-fg-muted">{currentLabel}</span>
			</nav>
			{@render children()}
		</main>
	</div>
</div>
