<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { api } from '$lib/api/client';
	import type { Project, User } from '$lib/api/types';
	import { roleLabel, roleShortLabel } from '$lib/roles';
	import { permissionFor } from '$lib/permissions';
	import { hasPermission, type Permission } from '$lib/rbac';
	import { appVersion } from '$lib/version';
	import { auth } from '$lib/stores/auth.svelte';
	import { feedback } from '$lib/stores/feedback.svelte';
	import Avatar from './Avatar.svelte';
	import VersionBanner from './VersionBanner.svelte';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';

	let { children } = $props();

	/** Typed so `resolve()` accepts these without a cast. */
	type NavPath =
		| '/'
		| '/users'
		| '/projects'
		| '/assign'
		| '/logs'
		| '/plugins'
		| '/system'
		| '/settings'
		| '/rbac'
		| '/profile';

	interface NavItem {
		path: NavPath;
		label: string;
		icon: IconName;
		/**
		 * 访问该页面所需的具名权限。
		 *
		 * 构造时从 $lib/permissions 的 PAGE_PERMISSIONS 填进来，不在这里
		 * 写死——路由守卫用的是同一张表，两边必须一致。
		 */
		perm?: Permission;
	}

	/**
	 * 侧边栏分组。
	 *
	 * 门槛不在这里写死，而是去 PAGE_PERMISSIONS 查——那份表同时被路由守卫
	 * 使用，两边因此不可能对不上。写成两份的话，就会出现「菜单里没有这个
	 * 入口、但地址栏输进去能打开」的页面。
	 *
	 * 分组按「什么时候会打开它」划分，而不是按功能相似度——原先的
	 * 「工作空间 / 系统」两组里，日志审计、插件与统计、系统设置被塞在一起，
	 * 但这三者一个值班时看、一个查数据规模、一个改配置，凑在一起反而看不出
	 * 该去哪。现在按使用场景分三组，组内权限门槛也依次递进，顺带让权限少的
	 * 用户的侧边栏从下往上依次变短。
	 */
	const navGroups: { label: string; items: NavItem[] }[] = [
		{
			// 盯场：比赛期间一直开着的那几页。
			label: '工作台',
			items: [
				{ path: '/', label: '总览', icon: 'overview' },
				{ path: '/system', label: '系统监控', icon: 'monitor' },
				{ path: '/logs', label: '日志与审计', icon: 'logs' }
			]
		},
		{
			// 配置：赛前把人和项目安排好，之后很少动。
			label: '赛事配置',
			items: [
				{ path: '/projects', label: '项目管理', icon: 'projects' },
				{ path: '/users', label: '用户管理', icon: 'users' },
				{ path: '/assign', label: '权限分配', icon: 'assign' }
			]
		},
		{
			// 数据与系统：出问题时往下查，或由超管改服务本身。
			label: '数据与系统',
			items: [
				{ path: '/plugins', label: '插件与统计', icon: 'plugins' },
				// 「谁能改权限」的唯一入口，门槛与系统设置同级（system.maintain）。
				// 刻意不写 perm —— 门槛统一从 PAGE_PERMISSIONS 查，那张表同时被
				// 路由守卫使用，写两份就一定会有一处对不上。
				{ path: '/rbac', label: '角色权限', icon: 'check' },
				{ path: '/settings', label: '系统设置', icon: 'settings' }
			]
		}
	];

	/** 按当前权限过滤后的导航。门槛统一从 PAGE_PERMISSIONS 取。 */
	const visibleNavGroups = $derived(
		navGroups
			.map((group) => ({
				...group,
				items: group.items
					.map((item) => ({ ...item, perm: permissionFor(item.path) }))
					.filter((item) => !item.perm || hasPermission(auth.permissions, item.perm))
			}))
			.filter((group) => group.items.length > 0)
	);

	/**
	 * 搜索用的扁平索引。
	 *
	 * 必须是 $derived：直接写 `visibleNavGroups.flatMap(...)` 只会捕获
	 * $derived 的初始值，之后权限变化（比如切换账号）索引不会跟着更新。
	 */
	const flatNav = $derived(visibleNavGroups.flatMap((group) => group.items));

	interface SearchItem {
		id: string;
		label: string;
		meta: string;
		href: NavPath;
		group: '用户' | '项目';
	}

	let online = $state<number | null>(null);
	let version = $state('');
	/** 后端声明的最低客户端版本；空串表示后端没声明。 */
	let minClientVersion = $state('');
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
	/**
	 * 不进侧边栏的页面，单独给面包屑一个名字。
	 *
	 * 个人中心按设计只在用户菜单里，不占侧边栏位置，所以 flatNav 里没有它，
	 * 而面包屑找不到时会回退成「总览」——在个人中心页上显示「总览」是错的。
	 */
	const extraPageLabels: Record<string, string> = { '/profile': '个人中心' };

	const currentLabel = $derived(
		flatNav.find((item) => normalise(resolve(item.path)) === current)?.label ??
			extraPageLabels[current] ??
			'总览'
	);
	const displayName = $derived(auth.user?.display_name || auth.user?.username || '管理员');
	/**
	 * 右上角的角色标签。
	 *
	 * 这里原来写的是 `auth.isAdmin ? '管理员' : '成员'` —— 六个角色被压成两档，
	 * 超管、负责人、前期、后勤全显示成「成员」。这类三元表达式在 AppShell、
	 * 用户页、权限分配页各有一份，加角色时必然漏改，所以统一走 roleShortLabel。
	 *
	 * 用短标签而不是全称：这一格宽度只有百来像素，「超级管理员」会把它撑变形。
	 */
	const roleTag = $derived(roleShortLabel(auth.user?.role ?? ''));
	/** 后端算好的 WeAvatar 地址；空串表示没填邮箱，由 Avatar 组件回退到首字母。 */
	const avatarUrl = $derived(auth.user?.avatar_url ?? '');

	async function refreshStatus() {
		try {
			const status = await api.status();
			online = status.online_count;
			version = status.version;
			// 后端声明的最低适配版本。老后端没有这个字段，保持空串即可 ——
			// 横幅会退回「版本不等就提醒」，而不是不出声。
			minClientVersion = status.min_client_version ?? '';
		} catch {
			online = null;
		}
	}

	/** Users and projects power the quick jump; a failure just empties the list. */
	async function loadIndex() {
		// 两类条目各按自己的权限取：索引里的每一条都会跳到对应页面，
		// 索引到一个进不去的页面等于「点了报错」。
		const wantUsers = auth.can('user.view');
		const wantProjects = auth.can('project.manage');
		if (!wantUsers && !wantProjects) {
			indexReady = true;
			return;
		}
		try {
			// 各自兜底而不是一起 Promise.all：后端少开一个接口不该把整份索引废掉。
			const [users, projects] = await Promise.all([
				wantUsers ? api.listUsers().catch(() => [] as User[]) : Promise.resolve([]),
				wantProjects ? api.listProjects().catch(() => [] as Project[]) : Promise.resolve([])
			]);
			index = [
				...users.map((user) => ({
					id: `user-${user.id}`,
					label: user.display_name || user.username,
					meta: `@${user.username} · ${roleLabel(user.role)}`,
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
			{#each visibleNavGroups as group (group.label)}
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

		<!--
			这里原本还有一张「头像 + 姓名 + 角色 + 退出」的卡片，与右上角的
			用户菜单完全重复，而且两处的角色文案各写了一份三元表达式，角色一多
			就会显示得不一样。身份只保留右上角一处，退出登录也走那个菜单。
			底下这一块专职显示服务状态。
		-->
		<div class="shrink-0 border-t border-border px-4 py-3">
			<div class="flex items-center gap-2">
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
			</div>
			<!--
				版本单独一行。原来与「在线客户端」挤在同一行，用 ml-auto 推到右边，
				于是「本端 v1.4.0 · 后端 v1.4.0」这一串在小侧栏里会先被截断，
				而后端版本恰恰是最需要看清的那个。
			-->
			{#if version}
				<div class="mt-1.5 pl-4 font-mono text-[10px] text-fg-faint">
					本端 v{appVersion} · 后端 v{version}
				</div>
				<!--
					最低适配版本单独一行，而且默认就显示。

					为什么不只在横幅里出现：横幅只在「本端低于最低适配版本」时弹，
					而绝大多数时候两者是匹配的——于是这个值算出来了却从来没人看得见，
					像是白拿的字段。要判断「现在这个后端还能不能配我手上这版后台」，
					得能看到那个下限在哪。

					什么时候才不显示：老后端没有 min_client_version 字段，
					那时候显示一个空的下限比不显示更糟。
				-->
				{#if minClientVersion}
					<div class="mt-0.5 pl-4 font-mono text-[10px] text-fg-faint">
						最低适配 v{minClientVersion}
					</div>
				{/if}
			{/if}
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
				<!--
					这里原来有个铃铛「系统状态」按钮：onclick 只有一句
					`(userMenuOpen = false)`，点下去除了关掉用户菜单什么也不做，
					却带一个状态点，看起来像个能点的通知入口。
					在线数与版本已经由侧边栏底部承担，这里不再放一个点不动的按钮。
				-->

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
							<span class="block text-[10px] text-fg-faint">{roleTag}</span>
						</span>
						<Avatar url={avatarUrl} name={displayName} size={32} class="text-[11px]" />
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
								<!--
									个人中心按设计不放进侧边栏（它是「我的账号」，不是系统功能），
									所以入口放在这里。面包屑的名字在 extraPageLabels 里单独给。
								-->
								<button
									type="button"
									onclick={() => void goto(resolve('/profile'))}
									class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] text-fg-muted transition-colors hover:bg-primary-soft hover:text-primary-ink"
								>
									<Icon name="users" size={15} />
									个人中心
								</button>
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

		<!-- 版本不一致提示。放在 main 之外，这样横跨整个内容区而不受内边距影响。 -->
		<VersionBanner serverVersion={version} {minClientVersion} />

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
