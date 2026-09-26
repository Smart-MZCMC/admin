<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '$lib/api/client';
	import type { Message, Project, ProjectStats, User } from '$lib/api/types';
	import { auth } from '$lib/stores/auth.svelte';
	import { feedback } from '$lib/stores/feedback.svelte';
	import { formatMessage } from '$lib/format';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import Tag from '$lib/components/Tag.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import Button from '$lib/components/Button.svelte';

	let users = $state<User[]>([]);
	let projects = $state<Project[]>([]);
	let stats = $state<Map<number, ProjectStats>>(new Map());
	let recent = $state<Message[]>([]);
	let totalMessages = $state(0);
	let online = $state<number | null>(null);
	let loading = $state(true);
	let started = false;

	const typeState: Record<string, 'theme' | 'success' | 'warning' | 'error' | 'info' | 'neutral'> =
		{
			shot_state: 'theme',
			chat: 'info',
			interview_status: 'success',
			lock_update: 'warning',
			system: 'neutral',
			next_shot: 'theme',
			confirm_switch: 'success'
		};

	async function load() {
		loading = true;
		try {
			const [status, userList, projectList, logs] = await Promise.all([
				api.status().catch(() => null),
				api.listUsers(),
				api.listProjects(),
				api.listLogs({ limit: 8 }).catch(() => ({ total: 0, messages: [] as Message[] }))
			]);

			users = userList;
			projects = projectList;
			online = status?.online_count ?? null;
			totalMessages = logs.total ?? 0;
			recent = logs.messages ?? [];

			// One stats request per project; a failure just leaves that row blank.
			const results = await Promise.all(
				projectList.map(async (project) => {
					try {
						return [project.id, await api.projectStats(project.id)] as const;
					} catch {
						return null;
					}
				})
			);

			const next = new Map<number, ProjectStats>();
			for (const entry of results) {
				if (entry) next.set(entry[0], entry[1]);
			}
			stats = next;
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '加载总览数据失败');
		} finally {
			loading = false;
		}
	}

	// Wait for the session before hitting admin-only endpoints.
	$effect(() => {
		if (auth.loading || !auth.user || started) return;
		started = true;
		void load();
	});

	const projectRows = $derived(
		projects
			.map((project) => {
				const stat = stats.get(project.id);
				return {
					id: project.id,
					name: project.name,
					code: project.code,
					messages: stat?.message_count ?? 0,
					interviews: stat?.interview_points ?? 0,
					locked: stat?.lock_active ?? false,
					holder: stat?.lock_holder ?? 0
				};
			})
			.sort((a, b) => b.messages - a.messages)
	);

	const maxMessages = $derived(Math.max(1, ...projectRows.map((row) => row.messages)));
	const activeLocks = $derived(projectRows.filter((row) => row.locked).length);
	const totalInterviews = $derived(projectRows.reduce((sum, row) => sum + row.interviews, 0));
	const projectById = $derived(new Map(projects.map((project) => [project.id, project])));

	function shortTime(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value || '-';
		return date.toLocaleString('zh-CN', {
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		});
	}
</script>

<svelte:head><title>总览 - 管理后台</title></svelte:head>

<PageHeader title="运营总览" description="用户、项目与实时通信的整体运行情况。">
	{#snippet actions()}
		<Button variant="secondary" icon="refresh" disabled={loading} onclick={() => void load()}>
			刷新数据
		</Button>
		<Button variant="primary" icon="projects" onclick={() => void goto(resolve('/projects'))}>
			管理项目
		</Button>
	{/snippet}
</PageHeader>

<div class="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
	<StatCard
		label="用户总数"
		value={loading ? null : users.length}
		icon="users"
		hint="含管理员与导播账号"
	/>
	<StatCard
		label="项目总数"
		value={loading ? null : projects.length}
		icon="projects"
		tone="info"
		hint={`${totalInterviews} 个采访点`}
	/>
	<StatCard
		label="在线客户端"
		value={loading ? null : online}
		icon="activity"
		tone="success"
		hint={online === null ? '服务器未连接' : 'WebSocket 实时连接数'}
	/>
	<StatCard
		label="消息累计"
		value={loading ? null : totalMessages}
		icon="logs"
		tone="warning"
		hint={`${activeLocks} 个项目控制权占用中`}
	/>
</div>

<div class="mt-5 grid gap-5 xl:grid-cols-[1.45fr_1fr]">
	<Panel title="最近动态" description="所有项目最近产生的通信记录。" bodyClass="p-0">
		{#snippet actions()}
			<Button size="sm" variant="ghost" icon="logs" onclick={() => void goto(resolve('/logs'))}>
				查看全部
			</Button>
		{/snippet}

		{#if loading}
			<Spinner label="正在加载动态…" />
		{:else if recent.length === 0}
			<div class="px-5 py-14 text-center">
				<p class="text-[12.5px] text-fg-faint">暂无通信记录</p>
				<p class="mt-1 text-[11.5px] text-fg-faint">各客户端开始通信后，动态会出现在这里。</p>
			</div>
		{:else}
			<ul class="divide-y divide-border">
				{#each recent as message (message.id)}
					<li class="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-bg-overlay/70">
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<Tag text={message.type} state={typeState[message.type] ?? 'neutral'} size="xs" />
								<span class="text-[11.5px] text-fg-muted">
									{projectById.get(message.project_id)?.name ?? `项目 #${message.project_id}`}
								</span>
							</div>
							<p class="mt-1.5 line-clamp-2 text-[12.5px] break-words text-fg">
								{formatMessage(message.type, message.content)}
							</p>
						</div>
						<span class="shrink-0 pt-0.5 font-mono text-[11px] whitespace-nowrap text-fg-faint">
							{shortTime(message.created_at)}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</Panel>

	<Panel title="项目概览" description="按消息量排序，显示控制权占用情况。" bodyClass="p-0">
		{#if loading}
			<Spinner label="正在统计项目…" />
		{:else if projectRows.length === 0}
			<div class="px-5 py-14 text-center">
				<p class="text-[12.5px] text-fg-faint">还没有项目</p>
				<p class="mt-1 text-[11.5px] text-fg-faint">创建项目后即可开始分配与导播。</p>
			</div>
		{:else}
			<ul class="divide-y divide-border">
				{#each projectRows as row (row.id)}
					<li class="px-5 py-3.5">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<div class="truncate text-[12.5px] font-medium text-fg">{row.name}</div>
								<div class="mt-0.5 font-mono text-[11px] text-fg-faint">{row.code}</div>
							</div>
							{#if row.locked}
								<Tag text={`占用中 #${row.holder}`} state="warning" size="xs" />
							{:else}
								<Tag text="空闲" state="neutral" size="xs" />
							{/if}
						</div>
						<div class="mt-2.5 flex items-center gap-3">
							<div class="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-overlay">
								<div
									class="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500"
									style="width:{Math.round((row.messages / maxMessages) * 100)}%"
								></div>
							</div>
							<span class="shrink-0 text-[11px] tabular-nums text-fg-muted">
								{row.messages} 条 · {row.interviews} 采访点
							</span>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</Panel>
</div>
