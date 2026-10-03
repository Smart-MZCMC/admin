<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api/client';
	import type { AuditLog, Message, Project } from '$lib/api/types';
	import { auth } from '$lib/stores/auth.svelte';
	import { feedback } from '$lib/stores/feedback.svelte';
	import { formatMessage } from '$lib/format';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import Tag from '$lib/components/Tag.svelte';
	import Button from '$lib/components/Button.svelte';

	/**
	 * 两个 Tab。
	 *
	 * 这个页面以前叫「日志审计」，但显示的是 messages 表里的协调日志
	 * （谁切了台、谁发了内部消息）。真正的操作审计（谁改了别人的角色、
	 * 谁清掉了日志）根本不存在——auditAction/auditRoleChange 只往 7 天轮转的
	 * stdout 打，而且只覆盖三处操作。B4 之后两者分开，名字也不再骗人。
	 */
	type Tab = 'messages' | 'audit';
	let tab = $state<Tab>('messages');

	// shot_state 是现行切台类型；next_shot / confirm_switch 是协议升级前的
	// 历史类型，保留在筛选里，方便回溯旧日志。
	const MESSAGE_TYPES = [
		'shot_state',
		'chat',
		'interview_status',
		'lock_update',
		'system',
		'next_shot',
		'confirm_switch'
	];

	let messages = $state<Message[]>([]);
	let projects = $state<Project[]>([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	let exporting = $state(false);
	let total = $state(0);
	let nextCursor = $state(0);

	let filterProject = $state('');
	let filterType = $state('');
	let filterSender = $state('');
	let filterFrom = $state('');
	let filterTo = $state('');
	let limit = $state('100');

	// --- 操作审计 ---
	let auditLogs = $state<AuditLog[]>([]);
	let auditActions = $state<string[]>([]);
	let auditLoading = $state(false);
	let auditLoadingMore = $state(false);
	let auditLoaded = $state(false);
	let auditTotal = $state(0);
	let auditNextCursor = $state(0);
	let auditAction = $state('');
	let auditActor = $state('');
	let auditFrom = $state('');
	let auditTo = $state('');

	let cleanupOpen = $state(false);
	let cleanupDays = $state('30');
	let cleaning = $state(false);

	const columns = [
		{ key: 'id', label: 'ID', width: '4.5rem' },
		{ key: 'created_at', label: '时间', width: '12rem' },
		{ key: 'project_id', label: '项目', width: '11rem' },
		{ key: 'sender_id', label: '发送者', width: '11rem' },
		{ key: 'type', label: '类型', width: '10rem' },
		{ key: 'content', label: '内容' }
	];

	const auditColumns = [
		{ key: 'created_at', label: '时间', width: '12rem' },
		{ key: 'actor_username', label: '操作者', width: '9rem' },
		{ key: 'action', label: '动作', width: '13rem' },
		{ key: 'target', label: '对象', width: '11rem' },
		{ key: 'ip', label: '来源 IP', width: '8.5rem' },
		{ key: 'detail', label: '详情' }
	];

	const projectById = $derived(new Map(projects.map((project) => [project.id, project])));

	/**
	 * 这一页上三个动作各要一项权限，彼此独立。
	 *
	 * 页面门槛只是 log.view（读），但负责人**没有** log.cleanup 与 audit.view，
	 * 所以「清理过期日志」和「操作审计」这两个 Tab 对他是点了必然 403 的。
	 * 这正是权限迁移要消灭的「菜单里有、点了报错」，按权限名藏掉即可。
	 */
	const canExport = $derived(auth.can('log.export'));
	const canCleanup = $derived(auth.can('log.cleanup'));
	const canViewAudit = $derived(auth.can('audit.view'));

	function projectLabel(projectId: number): string {
		const project = projectById.get(projectId);
		return project ? `${project.name}` : `#${projectId}`;
	}

	/**
	 * 默认时间范围：最近 7 天。
	 *
	 * 导出接口的 from/to 是必填的（后端不再允许对整个项目历史做无条件查询），
	 * 所以界面必须给一个默认值，否则那个按钮永远点不动。用 datetime-local
	 * 能接受的 `YYYY-MM-DDTHH:mm` 形式。
	 */
	function defaultRange(days: number): string {
		const now = new Date();
		const from = new Date(now.getTime() - days * 24 * 3600 * 1000);
		const pad = (n: number) => String(n).padStart(2, '0');
		const fmt = (d: Date) =>
			`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
		return `${fmt(from)}|${fmt(now)}`;
	}

	async function load() {
		loading = true;
		try {
			const result = await api.listLogs({
				projectId: filterProject || undefined,
				type: filterType || undefined,
				senderId: filterSender || undefined,
				from: filterFrom || undefined,
				to: filterTo || undefined,
				limit: Number(limit)
			});
			messages = result.messages ?? [];
			// total 是真实总行数，不是本页长度——以前后端返回的正是后者。
			total = result.total ?? 0;
			nextCursor = result.has_more ? result.next_cursor : 0;
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '加载日志失败');
			messages = [];
			total = 0;
			nextCursor = 0;
		} finally {
			loading = false;
		}
	}

	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		loadingMore = true;
		try {
			const result = await api.listLogs({
				projectId: filterProject || undefined,
				type: filterType || undefined,
				senderId: filterSender || undefined,
				from: filterFrom || undefined,
				to: filterTo || undefined,
				limit: Number(limit),
				cursor: nextCursor
			});
			messages = [...messages, ...(result.messages ?? [])];
			nextCursor = result.has_more ? result.next_cursor : 0;
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '加载更多失败');
		} finally {
			loadingMore = false;
		}
	}

	async function loadAudit() {
		auditLoading = true;
		try {
			const result = await api.auditLogs({
				action: auditAction || undefined,
				actorId: auditActor || undefined,
				from: auditFrom || undefined,
				to: auditTo || undefined,
				limit: Number(limit)
			});
			auditLogs = result.logs ?? [];
			auditActions = result.actions ?? [];
			auditTotal = result.total ?? 0;
			auditNextCursor = result.has_more ? result.next_cursor : 0;
			auditLoaded = true;
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '加载操作审计失败');
			auditLogs = [];
			auditTotal = 0;
			auditNextCursor = 0;
			auditLoaded = true;
		} finally {
			auditLoading = false;
		}
	}

	async function loadMoreAudit() {
		if (!auditNextCursor || auditLoadingMore) return;
		auditLoadingMore = true;
		try {
			const result = await api.auditLogs({
				action: auditAction || undefined,
				actorId: auditActor || undefined,
				from: auditFrom || undefined,
				to: auditTo || undefined,
				limit: Number(limit),
				cursor: auditNextCursor
			});
			auditLogs = [...auditLogs, ...(result.logs ?? [])];
			auditNextCursor = result.has_more ? result.next_cursor : 0;
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '加载更多失败');
		} finally {
			auditLoadingMore = false;
		}
	}

	function switchTab(next: Tab) {
		tab = next;
		if (next === 'audit' && !auditLoaded) void loadAudit();
	}

	onMount(async () => {
		const [from, to] = defaultRange(7).split('|');
		filterFrom = from;
		filterTo = to;
		auditFrom = from;
		auditTo = to;

		try {
			// myProjects 而不是 listProjects：后者挂在 project.manage 后面，
			// 负责人没有它，于是他连项目筛选下拉都是空的、导出按钮永远点不动。
			projects = await api.myProjects();
		} catch {
			// Non-fatal: the log table falls back to raw project ids.
		}
		await load();
	});

	function formatTime(value: string): string {
		if (!value) return '-';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;
		return date.toLocaleString('zh-CN', { hour12: false });
	}

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

	/** 动作名前缀对应的标签配色。 */
	function auditState(action: string): 'error' | 'warning' | 'success' | 'neutral' {
		if (action.startsWith('logs.cleanup')) return 'error';
		if (action.startsWith('user.')) return 'warning';
		if (action.startsWith('project.')) return 'success';
		return 'neutral';
	}

	function csvEscape(value: unknown): string {
		const text = value === null || value === undefined ? '' : String(value);
		return `"${text.replace(/"/g, '""')}"`;
	}

	function download(filename: string, text: string, mime: string) {
		const blob = new Blob([text], { type: mime });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = filename;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	function stamp(): string {
		return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	}

	/**
	 * POST /api/logs/export 从服务端导出一份 JSON 文件。
	 *
	 * 必须带时间范围：后端已经强制要求 from/to，并且对结果行数设了上限，
	 * 不再允许对整个项目历史做一次无条件查询。
	 */
	async function exportJson() {
		if (!filterProject) {
			feedback.error('请先选择要导出的项目');
			return;
		}
		if (!filterFrom || !filterTo) {
			feedback.error('请先选择时间范围（导出接口要求 from/to 必填）');
			return;
		}
		exporting = true;
		try {
			const result = await api.exportLogs(Number(filterProject), filterFrom, filterTo);
			download(
				`logs-project${filterProject}-${stamp()}.json`,
				JSON.stringify(result, null, 2),
				'application/json'
			);
			feedback.success(
				result.truncated
					? `已导出 ${result.count} 条（触及 ${result.limit} 行上限，请缩小时间范围后再导一次）`
					: `已导出 ${result.count} 条日志`
			);
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '导出失败');
		} finally {
			exporting = false;
		}
	}

	/**
	 * 把当前查询结果导出为 CSV。
	 *
	 * 在浏览器端拼装而不是走服务端：服务端那份文件没有任何人读，只会在
	 * storage/exports 里一直涨（现在由 log-archive 插件按保留天数清理）。
	 * 这样导出还自动遵守了当前筛选条件。
	 */
	function exportCsv() {
		if (messages.length === 0) {
			feedback.error('当前没有可导出的日志');
			return;
		}
		const header = [
			'id',
			'created_at',
			'project_id',
			'project_name',
			'sender_id',
			'type',
			'content'
		];
		const lines = [header.join(',')];
		for (const message of messages) {
			lines.push(
				[
					message.id,
					message.created_at,
					message.project_id,
					projectLabel(message.project_id),
					message.sender_id,
					message.type,
					message.content
				]
					.map(csvEscape)
					.join(',')
			);
		}
		download(`logs-${stamp()}.csv`, '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8');
		feedback.success(`已导出 ${messages.length} 条日志`);
	}

	async function runCleanup() {
		cleaning = true;
		try {
			const days = Number(cleanupDays) || 30;
			const result = await api.cleanupLogs(days);
			cleanupOpen = false;
			feedback.success(result.message || `已清理 ${result.count} 条日志`);
			await load();
			// 清理本身也会写一条审计记录，切到那个 Tab 就能看到。
			if (auditLoaded) await loadAudit();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '清理失败');
		} finally {
			cleaning = false;
		}
	}

	const controlClass =
		'h-9 w-full rounded-[var(--radius-form)] border border-border bg-bg-surface px-3 text-[12.5px] text-fg transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none';

	const tabClass = (active: boolean) =>
		`cursor-pointer rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
			active ? 'bg-primary-soft text-primary-ink' : 'text-fg-muted hover:bg-bg-hover hover:text-fg'
		}`;
</script>

<svelte:head><title>日志与审计 - 管理后台</title></svelte:head>

<PageHeader
	title="日志与审计"
	description="协调日志记录实时通信内容；操作审计记录谁改动了账号、项目与数据。"
>
	{#snippet actions()}
		<Button
			variant="secondary"
			icon="refresh"
			disabled={tab === 'audit' ? auditLoading : loading}
			onclick={() => (tab === 'audit' ? void loadAudit() : void load())}
		>
			重新查询
		</Button>
	{/snippet}
</PageHeader>

<div class="mb-4 flex gap-1.5 border-b border-border pb-2">
	<button type="button" class={tabClass(tab === 'messages')} onclick={() => switchTab('messages')}>
		协调日志
	</button>
	<!-- 操作审计要 audit.view（管理员及以上）。负责人看得到日志，但看不到审计。 -->
	{#if canViewAudit}
		<button type="button" class={tabClass(tab === 'audit')} onclick={() => switchTab('audit')}>
			操作审计
		</button>
	{/if}
</div>

{#if tab === 'messages'}
	<div class="space-y-5">
		<Panel
			title="检索条件"
			description="按项目、类型、发送者与时间范围检索；默认最近 7 天、100 条。"
		>
			<div class="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-medium text-fg">项目</span>
					<select bind:value={filterProject} class={controlClass}>
						<option value="">全部项目</option>
						{#each projects as project (project.id)}
							<option value={String(project.id)}>{project.name} ({project.code})</option>
						{/each}
					</select>
				</label>

				<label class="block">
					<span class="mb-1.5 block text-[12px] font-medium text-fg">消息类型</span>
					<select bind:value={filterType} class={controlClass}>
						<option value="">全部类型</option>
						{#each MESSAGE_TYPES as type (type)}
							<option value={type}>{type}</option>
						{/each}
					</select>
				</label>

				<label class="block">
					<span class="mb-1.5 block text-[12px] font-medium text-fg">发送者 ID</span>
					<input
						type="number"
						min="0"
						bind:value={filterSender}
						placeholder="全部"
						class={controlClass}
					/>
				</label>

				<label class="block">
					<span class="mb-1.5 block text-[12px] font-medium text-fg">开始时间</span>
					<input type="datetime-local" bind:value={filterFrom} class={controlClass} />
				</label>

				<label class="block">
					<span class="mb-1.5 block text-[12px] font-medium text-fg">结束时间</span>
					<input type="datetime-local" bind:value={filterTo} class={controlClass} />
				</label>

				<label class="block">
					<span class="mb-1.5 block text-[12px] font-medium text-fg">每页条数</span>
					<select bind:value={limit} class={controlClass}>
						<option value="100">100</option>
						<option value="200">200</option>
						<option value="500">500</option>
					</select>
				</label>
			</div>

			<div class="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
				<Button variant="primary" disabled={loading} onclick={() => void load()}>
					{loading ? '查询中...' : '查询'}
				</Button>
				<!--
					导出与清理各要一项权限，且互不相同（log.export / log.cleanup），
					早期它们被绑在一起，于是「只能导不能清」的人被迫持有删除权限。
				-->
				{#if canExport}
					<Button
						variant="secondary"
						icon="download"
						disabled={exporting}
						onclick={() => void exportJson()}
					>
						{exporting ? '导出中...' : '导出 JSON'}
					</Button>
					<Button variant="secondary" icon="download" onclick={exportCsv}>
						导出 CSV（当前结果）
					</Button>
				{/if}
				{#if canCleanup}
					<Button variant="danger-ghost" icon="trash" onclick={() => (cleanupOpen = true)}>
						清理过期日志
					</Button>
				{/if}
				<span class="ml-auto text-[11.5px] text-fg-muted">
					匹配 {total} 条，已加载 {messages.length} 条
				</span>
			</div>
		</Panel>

		<Panel title="协调日志" description="按时间倒序排列。" bodyClass="p-0">
			<DataTable
				{columns}
				rows={messages}
				rowKey={(message) => message.id}
				{loading}
				emptyText="没有符合当前条件的日志记录"
			>
				{#snippet cell(message, column)}
					{#if column.key === 'id'}
						<span class="font-mono text-[11.5px] text-fg-faint">#{message.id}</span>
					{:else if column.key === 'created_at'}
						<span class="font-mono text-[11.5px] whitespace-nowrap text-fg-muted">
							{formatTime(message.created_at)}
						</span>
					{:else if column.key === 'project_id'}
						<span class="text-fg">{projectLabel(message.project_id)}</span>
						<span class="ml-1 font-mono text-[11px] text-fg-faint">#{message.project_id}</span>
					{:else if column.key === 'sender_id'}
						<!--
							显示昵称而不是光一个 #id。协调日志里发言的不止导播
							（解说、包装、采访都能发），一列数字编号没法判断是谁。
							后端在 /api/logs 里预加载了 Sender。
						-->
						{#if message.sender}
							<span class="text-fg">{message.sender.display_name || message.sender.username}</span>
							<span class="ml-1 font-mono text-[11px] text-fg-faint">#{message.sender_id}</span>
						{:else}
							<!--
								取不到多半是账号已被删除（外键关联查不到就是 nil）。
								这时退回 #id：显示「未知」会让人以为系统没记录发送者，
								而实际上有 id、只是人没了。
							-->
							<span class="text-fg-faint">已注销</span>
							<span class="ml-1 font-mono text-[11px] text-fg-faint">#{message.sender_id}</span>
						{/if}
					{:else if column.key === 'type'}
						<Tag text={message.type} state={typeState[message.type] ?? 'neutral'} size="sm" />
					{:else if column.key === 'content'}
						<span class="block max-w-xl break-words text-fg-muted">
							{formatMessage(message.type, message.content)}
						</span>
					{:else}
						{(message as unknown as Record<string, unknown>)[column.key] || '-'}
					{/if}
				{/snippet}

				{#snippet footer()}
					<div class="flex items-center justify-between gap-3">
						<span>共 {total} 条，本页显示 {messages.length} 条</span>
						{#if nextCursor}
							<Button
								size="sm"
								variant="secondary"
								disabled={loadingMore}
								onclick={() => void loadMore()}
							>
								{loadingMore ? '加载中...' : '加载更多'}
							</Button>
						{/if}
					</div>
				{/snippet}
			</DataTable>
		</Panel>
	</div>
{:else}
	<div class="space-y-5">
		<Panel title="检索条件" description="审计记录里的用户名已脱敏，精确追溯请用操作者 ID。">
			<div class="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-medium text-fg">动作</span>
					<select bind:value={auditAction} class={controlClass}>
						<option value="">全部动作</option>
						{#each auditActions as action (action)}
							<option value={action}>{action}</option>
						{/each}
					</select>
				</label>

				<label class="block">
					<span class="mb-1.5 block text-[12px] font-medium text-fg">操作者 ID</span>
					<input
						type="number"
						min="0"
						bind:value={auditActor}
						placeholder="全部"
						class={controlClass}
					/>
				</label>

				<label class="block">
					<span class="mb-1.5 block text-[12px] font-medium text-fg">开始时间</span>
					<input type="datetime-local" bind:value={auditFrom} class={controlClass} />
				</label>

				<label class="block">
					<span class="mb-1.5 block text-[12px] font-medium text-fg">结束时间</span>
					<input type="datetime-local" bind:value={auditTo} class={controlClass} />
				</label>

				<div class="flex items-end">
					<Button full variant="primary" disabled={auditLoading} onclick={() => void loadAudit()}>
						{auditLoading ? '查询中...' : '查询'}
					</Button>
				</div>
			</div>
		</Panel>

		<Panel
			title="操作审计"
			description="删除账号、改角色、项目增删改、权限授予撤销、日志清理、改个人资料都会留痕。"
			bodyClass="p-0"
		>
			<DataTable
				columns={auditColumns}
				rows={auditLogs}
				rowKey={(log) => log.id}
				loading={auditLoading}
				emptyText="暂无审计记录"
			>
				{#snippet cell(log, column)}
					{#if column.key === 'created_at'}
						<span class="font-mono text-[11.5px] whitespace-nowrap text-fg-muted">
							{formatTime(log.created_at)}
						</span>
					{:else if column.key === 'actor_username'}
						<span class="text-fg">{log.actor_username || '-'}</span>
						<span class="ml-1 font-mono text-[11px] text-fg-faint">#{log.actor_id}</span>
					{:else if column.key === 'action'}
						<Tag text={log.action} state={auditState(log.action)} size="sm" />
					{:else if column.key === 'target'}
						{#if log.target_type}
							<span class="text-fg-muted">{log.target_type}</span>
							<span class="ml-1 font-mono text-[11px] text-fg-faint">#{log.target_id}</span>
						{:else}
							<span class="text-fg-faint">—</span>
						{/if}
					{:else if column.key === 'ip'}
						<span class="font-mono text-[11.5px] text-fg-muted">{log.ip || '-'}</span>
					{:else if column.key === 'detail'}
						<span class="block max-w-xl break-words text-fg-muted">{log.detail || '-'}</span>
					{:else}
						{(log as unknown as Record<string, unknown>)[column.key] || '-'}
					{/if}
				{/snippet}

				{#snippet footer()}
					<div class="flex items-center justify-between gap-3">
						<span>共 {auditTotal} 条，本页显示 {auditLogs.length} 条</span>
						{#if auditNextCursor}
							<Button
								size="sm"
								variant="secondary"
								disabled={auditLoadingMore}
								onclick={() => void loadMoreAudit()}
							>
								{auditLoadingMore ? '加载中...' : '加载更多'}
							</Button>
						{/if}
					</div>
				{/snippet}
			</DataTable>
		</Panel>
	</div>
{/if}

<ConfirmDialog
	visible={cleanupOpen}
	title="清理过期日志"
	message="将删除早于指定天数的全部消息记录。此操作不可撤销，但会留下一条操作审计记录。"
	confirmText={cleaning ? '清理中...' : '确认清理'}
	danger
	onconfirm={runCleanup}
	onclose={() => (cleanupOpen = false)}
>
	<label class="block">
		<span class="mb-1.5 block text-[12px] font-medium text-fg">保留最近天数</span>
		<input
			type="number"
			min="1"
			bind:value={cleanupDays}
			class="h-10 w-full rounded-[var(--radius-form)] border border-border bg-bg-surface px-3 text-[13px] text-fg transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none"
		/>
	</label>
</ConfirmDialog>
