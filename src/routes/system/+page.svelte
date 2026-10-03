<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { api } from '$lib/api/client';
	import type { SystemMetrics } from '$lib/api/types';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import LiveValue from '$lib/components/LiveValue.svelte';
	import Meter from '$lib/components/Meter.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import RefreshIndicator from '$lib/components/RefreshIndicator.svelte';
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
	import {
		dbPingErrorLabel,
		dirSizeErrorLabel,
		metricEvents,
		nextPollDelay,
		tickingUptime,
		type MetricEvent,
		type WatchedMetrics
	} from '$lib/live-metrics';

	let metrics = $state<SystemMetrics | null>(null);
	let loading = $state(true);

	// 轮询间隔。倒计时、进度条与下面的调度全部读这一个常量。
	//
	// 全程只挂一个定时器，而且挂在 dueAt 上，不用 setInterval：接口慢的时候
	// setInterval 会让请求堆叠，而监控页本身是最容易被自己拖垮的一页。
	// 慢一轮就慢一轮，下一轮自然顺延。
	/**
	 * 轮询间隔。
	 *
	 * 取 3 秒而不是 1 秒：这个端点每次要递归遍历 3 个目录（database/storage/
	 * update，见后端 sysinfo 的 dirSize）并真实执行一次 SELECT 1，实测单次约
	 * 7.6ms（极小目录下的下限）。1 秒一轮 = 每分钟 60 次遍历，而 storage/logs
	 * 按配置保留 30 天，文件数随部署时长增长，越用越贵。
	 *
	 * 而真正需要秒级分辨率的运行时间不靠轮询——它由 tickingUptime 本地推进，
	 * 零网络成本。1 秒的实时感由 AppShell 的 /api/status（无 IO，约 2.8ms）承担。
	 */
	const POLL_MS = 3_000;

	/**
	 * 收到上次响应的客户端时刻，运行时间的本地推进锚点。
	 *
	 * 刻意不用后端返回的 collected_at：那是服务器时刻，与 Date.now() 相减会把
	 * 两台机器的时钟偏差算进来。每次 load 成功后重锚一次，定时器降频与网络延迟
	 * 都不会累积成漂移。
	 */
	let receivedAt = $state(0);
	/** 每秒推进一次的本地时钟，只为驱动运行时间；不参与任何请求调度。 */
	let tick = $state(0);

	let autoRefresh = $state(true);
	/**
	 * 下一次请求的预定时刻。它是「倒计时显示几秒」和「什么时候真的发请求」唯一的
	 * 基准，所以任何地方都不许另算一个 now + POLL_MS。
	 */
	let dueAt = $state(0);
	/**
	 * 最近一次**成功**读到数据的时刻。
	 *
	 * 与 dueAt 分开：接口失败时 dueAt 照常推进（不然会连着重试），而这个时刻停在
	 * 原地不动，「上次刷新」于是会一直变大——数据是旧的这件事本身就是提示。
	 */
	let lastOkAt = $state(0);

	async function load(silent = false) {
		if (!silent) loading = true;
		try {
			metrics = await api.systemMetrics();
			lastOkAt = Date.now();
			// 与 lastOkAt 同一客户端时钟：运行时间从这里开始本地推进。
			receivedAt = lastOkAt;
		} catch (err) {
			// 轮询失败不在页面上弹 toast：定时失败每 3 秒弹一次会把右下角淹掉。
			// 页面上的「上次刷新 N 秒前」本身就是失败信号。
			if (!silent) {
				feedback.error(err instanceof Error ? err.message : '读取运行指标失败');
			}
		} finally {
			loading = false;
			dueAt = Date.now() + POLL_MS;
		}
	}

	onMount(() => {
		// 首屏先把基准摆好，否则挂载后到第一次刷新之间倒计时是空的。
		dueAt = Date.now() + POLL_MS;
		// 独立的秒针。它不碰 dueAt、不发请求，暂停自动刷新时也照走——
		// 暂停的是「取新数据」，不是「让页面停止显示时间在流逝」。
		const id = setInterval(() => {
			tick = Date.now();
		}, 1000);
		void load();
		return () => clearInterval(id);
	});

	/**
	 * 运行时间：后端快照 + 本地经过的时间。
	 *
	 * 依赖 tick 只是为了让它随秒针重算；tick 本身不进这个表达式，所以读取
	 * metrics 时不会连带把定时器也建立起来。
	 */
	const uptimeSeconds = $derived(
		tickingUptime(metrics?.runtime.uptime_seconds, receivedAt, tick || lastOkAt)
	);

	async function pollOnce() {
		await load(true);
	}

	$effect(() => {
		const target = dueAt;
		if (!autoRefresh || target === 0) return;
		const id = setTimeout(
			() => untrack(() => void pollOnce()),
			nextPollDelay(Date.now(), target, POLL_MS)
		);
		return () => clearTimeout(id);
	});

	function toggleAuto() {
		autoRefresh = !autoRefresh;
		// 恢复时把基准重置到现在。暂停期间 dueAt 早已过期，直接沿用会连着补发一轮，
		// 表现为「刚点继续数据就连跳两下」。
		if (autoRefresh) dueAt = Date.now() + POLL_MS;
	}

	function refreshNow() {
		// load() 自己在结束时重置基准，手动刷新与定时刷新因此走的是同一条路径。
		void load();
	}

	/**
	 * 本轮刷新里真正发生的变化。
	 *
	 * 只保留最近一次：连着几轮各报各的会越积越多，而管理员关心的是「现在有什么
	 * 不对」，不是一份变化流水。
	 */
	let events = $state<MetricEvent[]>([]);
	// 同样是普通变量：上一轮的指标只用于比较，不参与渲染。
	let lastCompared: WatchedMetrics | null = null;
	let eventsTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const next = metrics;
		if (!next) return;
		const found = metricEvents(lastCompared, next);
		lastCompared = next;
		if (found.length === 0) return;
		events = found;
		// 连着两轮都有变化时，上一轮的定时器不能把这一轮的提示提前抹掉。
		clearTimeout(eventsTimer);
		eventsTimer = setTimeout(() => {
			events = [];
		}, 6000);
	});

	const memPercent = $derived(metrics ? heapUsedPercent(metrics.memory) : 0);

	/** 组件状态里是否有任何一个不是绿的。用于在页头给一个总提示。 */
	const unhealthy = $derived(
		(metrics?.components ?? []).filter((c) => c.status === 'error' || c.status === 'degraded')
			.length
	);
</script>

<svelte:head><title>系统监控 - 管理后台</title></svelte:head>

<PageHeader
	title="系统监控"
	description="本页汇总服务进程的运行指标、磁盘占用与各组件状态。程序路径与宿主机磁盘用量仅超级管理员可见。"
>
	{#snippet actions()}
		<RefreshIndicator
			enabled={autoRefresh}
			{dueAt}
			intervalMs={POLL_MS}
			{lastOkAt}
			onToggle={toggleAuto}
		/>
		{#if unhealthy > 0}
			<Tag text="{unhealthy} 项需关注" state="warning" />
		{/if}
		<!--
			变化提示合并成一枚标签，而不是每条一个。条数不定，散开排列会把页头
			撑成两行；而文案本身已经写清了「从几变成几」「已断开」，方向不必
			再靠颜色补一遍。
		-->
		{#if events.length > 0}
			<Tag text="本轮变化：{events.map((event) => event.label).join('；')}" state="info" />
		{/if}
		<Button variant="secondary" icon="refresh" disabled={loading} onclick={refreshNow}>
			立即刷新
		</Button>
	{/snippet}
</PageHeader>

{#if loading && !metrics}
	<Spinner label="正在读取运行指标" />
{:else if metrics}
	<!--
		enter-stagger：四张卡片依次淡入，间隔 40ms、封顶 160ms。
		再多就会变成「页面在加载」的错觉，而它们是同时到齐的。
	-->
	<div class="enter-stagger grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
		<StatCard
			label="运行时间"
			value={formatUptime(uptimeSeconds)}
			hint="进程启动于 {formatTime(metrics.runtime.started_at)}"
			icon="activity"
			tone="primary"
		/>
		<StatCard
			label="Go 版本"
			value={metrics.runtime.go_version}
			hint="运行中协程（goroutine）{metrics.runtime.goroutines} 个"
			icon="settings"
			tone="info"
		/>
		<StatCard
			label="CPU 核心"
			value="{metrics.runtime.num_cpu} 核"
			hint="进程 PID {metrics.runtime.pid}"
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

	<!--
		items-start 不能省。grid 默认 align-items: stretch，两栏会被拉成等高，
		而磁盘面板比内存面板多出一整块「应用目录占用」明细，于是内存面板底部留出
		一大片空白，看起来像有个框没画完。等高在这里没有任何价值——两个面板的
		内容本来就是独立的两件事，不存在需要对齐的行。
	-->
	<div class="enter-stagger mt-3.5 grid items-start gap-3.5 lg:grid-cols-2">
		<Panel title="内存占用" description="使用率按堆（heap）的可用部分计算，不含代码段与调用栈">
			<Meter
				label="当前使用率"
				percent={memPercent}
				note="{memPercent.toFixed(1)}%"
				tone={memoryTone(memPercent)}
			/>
			<!--
				这一组数字一律不加变化提示。累计分配只会单调增长、当前分配每轮都在漂，
				给它们挂提示等于挂了个不停闪的挂件，管理员很快就学会忽略它。
				真正「变了就说明发生了某件事」的是 GC 次数与磁盘余量，那两处才提示。
			-->
			<dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12px]">
				<div class="flex justify-between gap-2">
					<dt class="text-fg-muted">堆内当前分配（Alloc）</dt>
					<dd class="font-medium tabular-nums">{formatBytes(metrics.memory.alloc_bytes)}</dd>
				</div>
				<div class="flex justify-between gap-2">
					<dt class="text-fg-muted">堆内累计分配（Total）</dt>
					<dd class="font-medium tabular-nums">{formatBytes(metrics.memory.total_alloc_bytes)}</dd>
				</div>
				<div class="flex justify-between gap-2">
					<dt class="text-fg-muted">系统占用（Sys）</dt>
					<dd class="font-medium tabular-nums">{formatBytes(metrics.memory.sys_bytes)}</dd>
				</div>
				<div class="flex justify-between gap-2">
					<dt class="text-fg-muted">垃圾回收（GC）次数</dt>
					<dd class="font-medium">
						<LiveValue value={String(metrics.memory.num_gc)} rank={metrics.memory.num_gc} />
					</dd>
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

		<Panel
			title="磁盘空间"
			description="数据库、日志与程序文件通常位于同一分区，分区写满时会同时受影响"
		>
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
						<dd class="font-medium">
							<LiveValue
								value={formatBytes(metrics.disk.free_bytes)}
								rank={metrics.disk.free_bytes}
							/>
						</dd>
					</div>
				</dl>
			{:else}
				<p class="text-[12.5px] text-fg-muted">{metrics.disk.note}</p>
			{/if}

			<div class="mt-4 border-t border-border pt-3.5">
				<div class="mb-2 flex items-baseline justify-between gap-2 text-[12px]">
					<span class="font-medium text-fg-muted">应用目录占用</span>
					<LiveValue
						value={formatBytes(metrics.disk.app_bytes)}
						rank={metrics.disk.app_bytes}
						class="font-medium"
					/>
				</div>
				<ul class="space-y-1.5">
					{#each metrics.disk.app_bytes_detail as item (item.name)}
						<!--
							读不到大小时给一句人话，原文留在 title 里。
							界面上的判断标准是「这句要不要处理」：目录没建是正常状态，
							没权限才是问题。把 Go 的英文报错原样摆出来，两个情况长得
							一模一样，管理员只会连这一块一起忽略。行内文字长度也从
							原来的一句英文报错压到十个字以内，不再和下面两行的字节数
							长度差出四倍。
						-->
						<li class="flex items-center justify-between gap-3 text-[12px]">
							<span class="shrink-0 text-fg-muted">{item.name}</span>
							{#if item.error}
								<span class="text-[11.5px] text-error-ink" title={item.error}
									>{dirSizeErrorLabel(item.error)}</span
								>
							{:else}
								<span class="shrink-0 font-medium tabular-nums">{formatBytes(item.bytes)}</span>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		</Panel>
	</div>

	<div class="enter-panel mt-3.5">
		<Panel
			title="数据库连接"
			description="每次刷新都会实际执行一次查询，以确认连接可用，而非仅检查进程是否存活"
		>
			<div class="mb-3 flex flex-wrap items-center gap-2">
				<Tag text={metrics.database.driver} state="info" />
				<Tag
					text={metrics.database.ping.connected ? '已连接' : '未连接'}
					state={metrics.database.ping.connected ? 'success' : 'error'}
				/>
				{#if metrics.database.ping.version}
					<Tag text="v{metrics.database.ping.version}" state="neutral" />
				{/if}
				{#if metrics.database.ping.latency_ms > 0}
					<Tag text="查询耗时 {metrics.database.ping.latency_ms} 毫秒" state="neutral" />
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
					title={metrics.database.ping.error}
				>
					{dbPingErrorLabel(metrics.database.ping.error)}
				</p>
			{/if}
		</Panel>
	</div>

	<div class="enter-panel mt-3.5">
		<Panel title="组件健康状态" description="各后台组件的当前状态">
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
	</div>

	<div class="enter-panel mt-3.5">
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
	</div>
{/if}
