<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api/client';
	import type { SystemMetrics } from '$lib/api/types';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Meter from '$lib/components/Meter.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import Tag from '$lib/components/Tag.svelte';
	import { feedback } from '$lib/stores/feedback.svelte';
	import {
		componentState,
		componentStatusLabel,
		diskTone,
		formatBytes,
		formatTime,
		formatUptime,
		heapUsedPercent,
		memoryTone
	} from '$lib/format-metrics';

	let metrics = $state<SystemMetrics | null>(null);
	let loading = $state(true);

	// 轮询间隔。
	//
	// 串行 setTimeout 而不是 setInterval：接口慢的时候 setInterval 会让请求堆叠，
	// 而监控页本身是最容易被自己拖垮的一页。慢一轮就慢一轮，下一轮自然顺延。
	const POLL_MS = 10_000;

	async function load(silent = false) {
		if (!silent) loading = true;
		try {
			metrics = await api.systemMetrics();
		} catch (err) {
			// 轮询失败只在手动刷新时提示。定时失败每 10 秒弹一次 toast 会把
			// 右下角淹掉，而且操作员在断线期间已经能看到「上次更新于」的时间。
			if (!silent) {
				feedback.error(err instanceof Error ? err.message : '读取运行指标失败');
			}
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void load();
		let timer: ReturnType<typeof setTimeout>;
		const tick = async () => {
			await load(true);
			timer = setTimeout(tick, POLL_MS);
		};
		timer = setTimeout(tick, POLL_MS);
		return () => clearTimeout(timer);
	});

	const memPercent = $derived(metrics ? heapUsedPercent(metrics.memory) : 0);
	const platform = $derived(
		metrics
			? `${metrics.runtime.platform.split('/')[0]} / ${metrics.runtime.platform.split('/')[1] ?? ''}`
			: '—'
	);

	/** 组件状态里是否有任何一个不是绿的。用于在页头给一个总提示。 */
	const unhealthy = $derived(
		(metrics?.components ?? []).filter((c) => c.status === 'error' || c.status === 'degraded')
			.length
	);
</script>

<svelte:head><title>系统监控 - 管理后台</title></svelte:head>

<PageHeader
	title="系统监控"
	description="实时监控服务运行各项指标。此页会显示程序路径与宿主机磁盘用量，仅超级管理员可见。"
>
	{#snippet actions()}
		<span class="text-[11.5px] text-fg-faint tabular-nums">
			{#if metrics}更新于 {formatTime(metrics.collected_at)}{/if}
		</span>
		{#if unhealthy > 0}
			<Tag text="{unhealthy} 项需关注" state="warning" />
		{/if}
		<Button variant="secondary" icon="refresh" disabled={loading} onclick={() => void load()}>
			刷新
		</Button>
	{/snippet}
</PageHeader>

{#if loading && !metrics}
	<Spinner label="正在读取运行指标…" />
{:else if metrics}
	<div class="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
		<StatCard
			label="运行时间"
			value={formatUptime(metrics.runtime.uptime_seconds)}
			hint="启动于 {formatTime(metrics.runtime.started_at)}"
			icon="activity"
			tone="primary"
		/>
		<StatCard
			label="Go 版本"
			value={metrics.runtime.go_version}
			hint="{metrics.runtime.goroutines} 个协程在跑"
			icon="settings"
			tone="info"
		/>
		<StatCard
			label="CPU 核心"
			value="{metrics.runtime.num_cpu} 核"
			hint="PID {metrics.runtime.pid}"
			icon="overview"
			tone="slate"
		/>
		<StatCard
			label="在线客户端"
			value="{metrics.runtime.online_count} 个"
			hint="解说端 / 导播端 / 采访端 / 包装端"
			icon="users"
			tone="success"
		/>
	</div>

	<div class="mt-3.5 grid gap-3.5 lg:grid-cols-2">
		<Panel title="内存概览" description="按堆的可用部分计算，不含代码段与栈">
			<Meter
				label="当前使用率"
				percent={memPercent}
				note="{memPercent.toFixed(1)}%"
				tone={memoryTone(memPercent)}
			/>
			<dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12px]">
				<div class="flex justify-between gap-2">
					<dt class="text-fg-muted">当前分配 (Alloc)</dt>
					<dd class="font-medium tabular-nums">{formatBytes(metrics.memory.alloc_bytes)}</dd>
				</div>
				<div class="flex justify-between gap-2">
					<dt class="text-fg-muted">累计分配 (Total)</dt>
					<dd class="font-medium tabular-nums">{formatBytes(metrics.memory.total_alloc_bytes)}</dd>
				</div>
				<div class="flex justify-between gap-2">
					<dt class="text-fg-muted">系统占用 (Sys)</dt>
					<dd class="font-medium tabular-nums">{formatBytes(metrics.memory.sys_bytes)}</dd>
				</div>
				<div class="flex justify-between gap-2">
					<dt class="text-fg-muted">GC 次数</dt>
					<dd class="font-medium tabular-nums">{metrics.memory.num_gc}</dd>
				</div>
				<div class="flex justify-between gap-2">
					<dt class="text-fg-muted">最近一次 GC</dt>
					<dd class="font-medium tabular-nums">{formatTime(metrics.memory.last_gc)}</dd>
				</div>
				<div class="flex justify-between gap-2">
					<dt class="text-fg-muted">GC 占用 CPU</dt>
					<dd class="font-medium tabular-nums">
						{(metrics.memory.gc_cpu_fraction * 100).toFixed(2)}%
					</dd>
				</div>
			</dl>
		</Panel>

		<Panel title="磁盘空间" description="数据库、日志与程序通常在同一个分区，写满会一起出问题">
			{#if metrics.disk.supported}
				<Meter
					label="已使用"
					percent={metrics.disk.used_percent}
					note="{formatBytes(metrics.disk.used_bytes)} / {formatBytes(metrics.disk.total_bytes)}"
					tone={diskTone(metrics.disk.used_percent)}
				/>
				<dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12px]">
					<div class="flex justify-between gap-2">
						<dt class="text-fg-muted">挂载路径</dt>
						<dd class="font-mono text-[11.5px] font-medium">{metrics.disk.path}</dd>
					</div>
					<div class="flex justify-between gap-2">
						<dt class="text-fg-muted">剩余可用</dt>
						<dd class="font-medium tabular-nums">{formatBytes(metrics.disk.free_bytes)}</dd>
					</div>
				</dl>
			{:else}
				<p class="text-[12.5px] text-fg-muted">{metrics.disk.note}</p>
			{/if}

			<div class="mt-4 border-t border-border pt-3.5">
				<div class="mb-2 text-[12px] font-medium text-fg-muted">
					应用占用 <span class="tabular-nums">{formatBytes(metrics.disk.app_bytes)}</span>
				</div>
				<ul class="space-y-1.5">
					{#each metrics.disk.app_bytes_detail as item (item.name)}
						<li class="flex items-center justify-between gap-3 text-[12px]">
							<span class="text-fg-muted">{item.name}</span>
							{#if item.error}
								<span class="text-[11.5px] text-error-ink">{item.error}</span>
							{:else}
								<span class="font-medium tabular-nums">{formatBytes(item.bytes)}</span>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		</Panel>
	</div>

	<Panel title="数据库连接" description="真实执行一次查询的结果，而不是「进程在就算健康」">
		<div class="mb-3 flex flex-wrap items-center gap-2">
			<Tag text={metrics.database.driver} state="info" />
			<Tag
				text={metrics.database.ping.connected ? 'connected' : 'disconnected'}
				state={metrics.database.ping.connected ? 'success' : 'error'}
			/>
			{#if metrics.database.ping.version}
				<Tag text="v{metrics.database.ping.version}" state="neutral" />
			{/if}
			{#if metrics.database.ping.latency_ms > 0}
				<Tag text="探活 {metrics.database.ping.latency_ms}ms" state="neutral" />
			{/if}
		</div>
		<dl class="grid gap-x-4 gap-y-2.5 text-[12px] sm:grid-cols-2">
			<div class="flex justify-between gap-2">
				<dt class="text-fg-muted">库文件</dt>
				<dd class="truncate font-mono text-[11.5px] font-medium">{metrics.database.path}</dd>
			</div>
			<div class="flex justify-between gap-2">
				<dt class="text-fg-muted">文件大小</dt>
				<dd class="font-medium tabular-nums">{formatBytes(metrics.database.size_bytes)}</dd>
			</div>
		</dl>
		{#if metrics.database.ping.error}
			<p
				class="mt-3 rounded-[var(--radius-form)] bg-error-soft px-3 py-2 text-[12px] text-error-ink"
			>
				{metrics.database.ping.error}
			</p>
		{/if}
	</Panel>

	<Panel title="组件健康状态">
		<ul class="flex flex-wrap gap-2">
			{#each metrics.components as component (component.name)}
				<li
					class="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-overlay px-3 py-1.5 text-[12px]"
				>
					<span class="font-medium text-fg">{component.name}</span>
					<Tag
						text={componentStatusLabel(component.status)}
						state={componentState(component.status)}
						size="sm"
					/>
					{#if component.version}
						<span class="text-[11.5px] text-fg-faint tabular-nums">v{component.version}</span>
					{/if}
					{#if component.detail}
						<span class="text-[11.5px] text-fg-faint">{component.detail}</span>
					{/if}
				</li>
			{/each}
		</ul>
	</Panel>

	<Panel>
		<div class="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11.5px] text-fg-faint">
			<span>系统版本 {metrics.runtime.version}</span>
			<span class="inline-flex items-center gap-1">
				<Icon name="projects" size={12} />
				{metrics.runtime.working_dir}
			</span>
			<span class="font-mono">{metrics.runtime.executable}</span>
		</div>
	</Panel>
{/if}
