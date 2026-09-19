<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api/client';
	import type { PluginInfo, Project, ProjectStats } from '$lib/api/types';
	import { feedback } from '$lib/stores/feedback.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import Tag from '$lib/components/Tag.svelte';

	let plugins = $state<PluginInfo[]>([]);
	let projects = $state<Project[]>([]);
	let stats = $state<Map<number, ProjectStats>>(new Map());
	let loading = $state(true);

	const columns = [
		{ key: 'id', label: 'ID', width: '5rem' },
		{ key: 'name', label: '项目' },
		{ key: 'code', label: '编码', width: '11rem' },
		{ key: 'message_count', label: '消息数', width: '8rem' },
		{ key: 'interview_points', label: '采访点', width: '8rem' },
		{ key: 'lock', label: '控制权', width: '9rem' }
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

	const totalMessages = $derived(
		statsRows.reduce((sum, row) => sum + (row.message_count ?? 0), 0)
	);
	const activeLocks = $derived(
		statsRows.filter((row) => row.lock === true).length
	);
	const totalInterviewPoints = $derived(
		statsRows.reduce((sum, row) => sum + (row.interview_points ?? 0), 0)
	);
</script>

<svelte:head><title>插件与统计 - 管理后台</title></svelte:head>

<div class="space-y-5">
	<div class="grid gap-3 md:grid-cols-4">
		<StatCard label="已注册插件" value={loading ? null : plugins.length} />
		<StatCard label="项目总数" value={loading ? null : projects.length} />
		<StatCard label="消息总数" value={loading ? null : totalMessages} />
		<StatCard label="占用中的控制权" value={loading ? null : activeLocks} hint="{totalInterviewPoints} 个采访点" />
	</div>

	<Panel title="插件列表" description="由后端插件注册中心上报，插件异常不会影响主流程。">
		{#if loading}
			<Spinner />
		{:else if plugins.length === 0}
			<div class="py-6 text-center text-[13px] text-gray-500">
				暂无已注册插件。后端启动时会注册 ntfy-alert、log-archive、csv-export 等内置插件。
			</div>
		{:else}
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each plugins as plugin (plugin.name)}
					<div
						class="flex items-center justify-between gap-3 rounded-[var(--radius-form)] border border-white/5 bg-bg-base px-4 py-3"
					>
						<div>
							<div class="font-mono text-[13px] text-text-dark">{plugin.name}</div>
							<div class="mt-0.5 text-[11px] text-gray-500">v{plugin.version}</div>
						</div>
						<Tag text="已启用" state="success" size="sm" />
					</div>
				{/each}
			</div>
		{/if}
	</Panel>

	<Panel title="项目统计" description="每个项目的消息量、采访点数量与控制权占用情况。">
		{#if loading}
			<Spinner />
		{:else if projects.length === 0}
			<div class="py-6 text-center text-[13px] text-gray-500">暂无项目</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full border-collapse text-[13px]">
					<thead>
						<tr>
							{#each columns as column (column.key)}
								<th
									class="border-b border-white/10 px-4 py-3 text-left text-[11px] font-medium tracking-wider text-gray-500 uppercase"
									style={column.width ? `width:${column.width}` : undefined}
								>
									{column.label}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each statsRows as row (row.id)}
							<tr class="transition-colors hover:bg-primary/5">
								<td class="border-b border-white/5 px-4 py-3 text-gray-400">{row.id}</td>
								<td class="border-b border-white/5 px-4 py-3 text-text-dark">{row.name}</td>
								<td class="border-b border-white/5 px-4 py-3 font-mono text-[12px] text-gray-400">
									{row.code}
								</td>
								<td class="border-b border-white/5 px-4 py-3 text-gray-400">
									{row.message_count ?? '-'}
								</td>
								<td class="border-b border-white/5 px-4 py-3 text-gray-400">
									{row.interview_points ?? '-'}
								</td>
								<td class="border-b border-white/5 px-4 py-3">
									{#if row.lock === null}
										<span class="text-gray-600">-</span>
									{:else if row.lock}
										<Tag text="占用中 #{row.lock_holder}" state="warning" size="sm" />
									{:else}
										<Tag text="空闲" state="neutral" size="sm" />
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Panel>
</div>
