<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api/client';
	import type { PluginInfo, Project, ProjectStats } from '$lib/api/types';
	import { feedback } from '$lib/stores/feedback.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import Tag from '$lib/components/Tag.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let plugins = $state<PluginInfo[]>([]);
	let projects = $state<Project[]>([]);
	let stats = $state<Map<number, ProjectStats>>(new Map());
	let loading = $state(true);

	const columns = [
		{ key: 'id', label: 'ID', width: '4.5rem' },
		{ key: 'name', label: '项目' },
		{ key: 'code', label: '编码', width: '11rem' },
		{ key: 'message_count', label: '消息数', width: '8rem', align: 'right' as const },
		{ key: 'interview_points', label: '采访点', width: '8rem', align: 'right' as const },
		{ key: 'lock', label: '控制权', width: '10rem' }
	];

	async function load() {
		loading = true;
		try {
			const [pluginList, projectList] = await Promise.all([
				api.listPlugins().catch(() => [] as PluginInfo[]),
				api.listProjects()
			]);
			plugins = pluginList;
			projects = projectList;

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
			feedback.error(err instanceof Error ? err.message : '加载失败');
		} finally {
			loading = false;
		}
	}

	onMount(load);

	const statsRows = $derived(
		projects.map((project) => {
			const stat = stats.get(project.id);
			return {
				id: project.id,
				name: project.name,
				code: project.code,
				message_count: stat ? stat.message_count : null,
				interview_points: stat ? stat.interview_points : null,
				lock: stat ? stat.lock_active : null,
				lock_holder: stat ? stat.lock_holder : 0
			};
		})
	);

	const totalMessages = $derived(statsRows.reduce((sum, row) => sum + (row.message_count ?? 0), 0));
	const activeLocks = $derived(statsRows.filter((row) => row.lock === true).length);
	const totalInterviewPoints = $derived(
		statsRows.reduce((sum, row) => sum + (row.interview_points ?? 0), 0)
	);
</script>

<svelte:head><title>插件与统计 - 管理后台</title></svelte:head>

<PageHeader title="插件与统计" description="插件运行状态与各项目的数据规模。">
	{#snippet actions()}
		<Button variant="secondary" icon="refresh" disabled={loading} onclick={() => void load()}>
			刷新
		</Button>
	{/snippet}
</PageHeader>

<div class="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
	<StatCard label="已注册插件" value={loading ? null : plugins.length} icon="plugins" />
	<StatCard label="项目总数" value={loading ? null : projects.length} icon="projects" tone="info" />
	<StatCard
		label="消息总数"
		value={loading ? null : totalMessages}
		icon="logs"
		hint="{totalInterviewPoints} 个采访点"
	/>
	<StatCard
		label="占用中的控制权"
		value={loading ? null : activeLocks}
		icon="assign"
		tone="warning"
		hint="同一项目同一时间仅一名导播持有"
	/>
</div>

<div class="mt-5 space-y-5">
	<Panel
		title="插件列表"
		description="由后端插件注册中心上报，插件异常不会影响主流程。配置项来自后端环境变量，机密的取值已做脱敏。"
		bodyClass="p-5"
	>
		{#if loading}
			<Spinner label="正在读取插件注册中心…" />
		{:else if plugins.length === 0}
			<div
				class="rounded-[var(--radius-form)] border border-dashed border-border px-4 py-8 text-center"
			>
				<p class="text-[12.5px] text-fg-muted">暂无已注册插件</p>
				<p class="mt-1 text-[11.5px] text-fg-faint">
					后端启动时会注册 ntfy-alert、log-archive、csv-export 等内置插件。
				</p>
			</div>
		{:else}
			<div class="grid gap-3 sm:grid-cols-2">
				{#each plugins as plugin (plugin.name)}
					<div class="rounded-[var(--radius-form)] border border-border bg-bg-overlay/50 px-4 py-3">
						<div class="flex items-center gap-3">
							<span
								class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-surface text-fg-faint ring-1 ring-border"
							>
								<Icon name="plugins" size={16} />
							</span>
							<div class="min-w-0 flex-1">
								<div class="truncate font-mono text-[12.5px] text-fg">
									{plugin.name}
									<span class="font-sans text-[11px] text-fg-faint">v{plugin.version}</span>
								</div>
								<div class="mt-0.5 line-clamp-2 text-[11px] text-fg-faint">
									{plugin.description}
								</div>
							</div>
							<Tag
								text={plugin.enabled ? '已启用' : '已停用'}
								state={plugin.enabled ? 'success' : 'neutral'}
								size="xs"
							/>
						</div>

						{#if !plugin.enabled && plugin.reason}
							<p class="mt-2.5 text-[11.5px] text-warning-ink">{plugin.reason}</p>
						{/if}

						{#if Object.keys(plugin.config).length > 0}
							<dl class="mt-2.5 space-y-1 border-t border-border pt-2.5">
								{#each Object.entries(plugin.config) as [key, value] (key)}
									<div class="flex gap-2 text-[11.5px]">
										<dt class="shrink-0 text-fg-faint">{key}</dt>
										<dd class="min-w-0 truncate text-fg-muted" title={value}>{value}</dd>
									</div>
								{/each}
							</dl>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</Panel>

	<Panel
		title="项目统计"
		description="每个项目的消息量、采访点数量与控制权占用情况。"
		bodyClass="p-0"
	>
		<DataTable
			{columns}
			rows={statsRows}
			rowKey={(row) => row.id}
			{loading}
			emptyText="还没有项目可统计"
		>
			{#snippet cell(row, column)}
				{#if column.key === 'id'}
					<span class="font-mono text-[11.5px] text-fg-faint">#{row.id}</span>
				{:else if column.key === 'name'}
					<span class="font-medium text-fg">{row.name}</span>
				{:else if column.key === 'code'}
					<span class="font-mono text-[11.5px] text-fg-muted">{row.code}</span>
				{:else if column.key === 'message_count'}
					<span class="tabular-nums">{row.message_count ?? '—'}</span>
				{:else if column.key === 'interview_points'}
					<span class="tabular-nums">{row.interview_points ?? '—'}</span>
				{:else if column.key === 'lock'}
					{#if row.lock === null}
						<span class="text-fg-faint">—</span>
					{:else if row.lock}
						<Tag text={`占用中 #${row.lock_holder}`} state="warning" size="sm" />
					{:else}
						<Tag text="空闲" state="neutral" size="sm" />
					{/if}
				{:else}
					{(row as unknown as Record<string, unknown>)[column.key] ?? '—'}
				{/if}
			{/snippet}
		</DataTable>
	</Panel>
</div>
