<script lang="ts">
	/**
	 * 系统设置：运行环境 + 在线更新。仅超级管理员可见。
	 *
	 * 页面上会替换服务自身的可执行文件并让进程重启，所以确认环节做得很重：
	 * 必须先「检查更新」，看清目标版本，再点「应用」——应用时还要再确认一次，
	 * 并显式带上刚看到的版本号。后端会比对该版本号，避免「检查时是 1.2.0、
	 * 应用时装上 1.3.0」。
	 */
	import { onMount } from 'svelte';
	import { api } from '$lib/api/client';
	import type { HealthStatus, SystemInfo, UpdateStatus } from '$lib/api/types';
	import { auth } from '$lib/stores/auth.svelte';
	import { feedback } from '$lib/stores/feedback.svelte';
	import Button from '$lib/components/Button.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import Tag from '$lib/components/Tag.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

	let info = $state<SystemInfo | null>(null);
	let health = $state<HealthStatus | null>(null);
	let update = $state<UpdateStatus | null>(null);

	let loading = $state(true);
	let checking = $state(false);
	let applying = $state(false);
	let confirmOpen = $state(false);

	/** 把秒数换成「3 天 4 小时」这种可读形式。 */
	function uptime(seconds: number): string {
		const d = Math.floor(seconds / 86400);
		const h = Math.floor((seconds % 86400) / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		if (d > 0) return `${d} 天 ${h} 小时`;
		if (h > 0) return `${h} 小时 ${m} 分钟`;
		return `${m} 分钟`;
	}

	function size(bytes?: number): string {
		if (!bytes) return '—';
		return `${(bytes / 1048576).toFixed(1)} MB`;
	}

	async function load() {
		loading = true;
		// 健康检查是公开接口，不带令牌也能拿到总体可用性；
		// 其余三个都要求超管。分开调是为了让「服务不健康」也能显示出来，
		// 而不是整页跟着一起报错。
		const [h, i, u] = await Promise.allSettled([
			api.health(),
			api.systemInfo(),
			api.updateStatus()
		]);
		health = h.status === 'fulfilled' ? h.value : null;
		info = i.status === 'fulfilled' ? i.value : null;
		update = u.status === 'fulfilled' ? u.value : null;
		loading = false;
	}

	async function check() {
		checking = true;
		try {
			update = await api.updateStatus();
			if (update.error) feedback.error(update.error);
			else if (update.has_update) feedback.success(`发现新版本 ${update.latest_version}`);
			else feedback.success('已是最新版本');
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '检查更新失败');
		} finally {
			checking = false;
		}
	}

	async function apply() {
		if (!update?.latest_version) return;
		applying = true;
		try {
			const res = await api.applyUpdate(update.latest_version);
			if (res.replaced) {
				// 进程马上要退出了，这句提示得让人看见。
				feedback.success(`已更新到 ${res.version}，服务正在重启…${res.restart_hint ?? ''}`);
			} else {
				feedback.success(`新版本 ${res.version} 已下载并校验通过`);
			}
			confirmOpen = false;
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '更新失败');
		} finally {
			applying = false;
		}
	}

	onMount(() => void load());
</script>

<svelte:head><title>系统设置 - 管理后台</title></svelte:head>

<PageHeader
	title="系统设置"
	description="运行环境与在线更新。此页的操作会影响服务本身，仅超级管理员可见。"
>
	{#snippet actions()}
		<Button variant="secondary" icon="refresh" disabled={loading} onclick={() => void load()}>
			刷新
		</Button>
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-5">
	<Panel title="服务状态">
		{#if health}
			<div class="flex flex-wrap items-center gap-3">
				<Tag
					text={health.status === 'ok' ? '运行正常' : '数据库不可用'}
					state={health.status === 'ok' ? 'success' : 'error'}
				/>
				<span class="text-[13px] text-fg-muted">版本 {health.version}</span>
				<span class="text-[13px] text-fg-muted">已运行 {uptime(health.uptime_seconds)}</span>
				<Tag
					text={health.checks.database ? '数据库正常' : '数据库异常'}
					state={health.checks.database ? 'success' : 'error'}
					size="sm"
				/>
			</div>
			{#if health.detail}
				<p class="mt-2 text-[12px] text-error-ink">{health.detail}</p>
			{/if}
		{:else}
			<p class="text-[13px] text-fg-muted">健康检查暂不可用。</p>
		{/if}
	</Panel>

	{#if info}
		<Panel title="运行环境">
			<dl class="grid grid-cols-1 gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-2">
				<div class="flex justify-between gap-4">
					<dt class="text-fg-faint">版本</dt>
					<dd class="font-mono text-fg">{info.version}</dd>
				</div>
				<div class="flex justify-between gap-4">
					<dt class="text-fg-faint">运行时</dt>
					<dd class="font-mono text-fg">{info.runtime.go_version} / {info.runtime.platform}</dd>
				</div>
				<div class="flex justify-between gap-4">
					<dt class="text-fg-faint">CPU / 协程</dt>
					<dd class="font-mono text-fg">{info.runtime.num_cpu} / {info.runtime.goroutines}</dd>
				</div>
				<div class="flex justify-between gap-4">
					<dt class="text-fg-faint">进程 PID</dt>
					<dd class="font-mono text-fg">{info.runtime.pid}</dd>
				</div>
				<div class="flex justify-between gap-4">
					<dt class="text-fg-faint">在线客户端</dt>
					<dd class="font-mono text-fg">{info.runtime.online_count}</dd>
				</div>
				<div class="flex justify-between gap-4">
					<dt class="text-fg-faint">已运行</dt>
					<dd class="font-mono text-fg">{uptime(info.runtime.uptime_seconds)}</dd>
				</div>
				<div class="flex justify-between gap-4 sm:col-span-2">
					<dt class="text-fg-faint">可执行文件</dt>
					<dd class="truncate font-mono text-[12px] text-fg-muted" title={info.executable}>
						{info.executable}
					</dd>
				</div>
				<div class="flex justify-between gap-4 sm:col-span-2">
					<dt class="text-fg-faint">工作目录</dt>
					<dd class="truncate font-mono text-[12px] text-fg-muted" title={info.runtime.working_dir}>
						{info.runtime.working_dir}
					</dd>
				</div>
			</dl>
		</Panel>
	{/if}

	<Panel
		title="在线更新"
		description="从 GitHub Release 拉取后端发布包，校验 sha256 后替换并重启。"
	>
		{#snippet actions()}
			<Button variant="secondary" icon="refresh" disabled={checking} onclick={() => void check()}>
				{checking ? '检查中…' : '检查更新'}
			</Button>
		{/snippet}

		{#if !update}
			<p class="text-[13px] text-fg-muted">尚未获取更新信息。</p>
		{:else if !update.enabled}
			<p class="text-[13px] text-warning-ink">
				在线更新未启用。需要在后端 .env 里设置 <code class="font-mono">UPDATE_ENABLED=true</code>
				并重启服务。
			</p>
		{:else}
			<div class="flex flex-col gap-3 text-[13px]">
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-fg-faint">当前版本</span>
					<span class="font-mono text-fg">{update.current_version}</span>
					{#if update.has_update}
						<Tag text={`可更新到 ${update.latest_version}`} state="warning" />
					{:else}
						<Tag text="已是最新" state="success" />
					{/if}
				</div>

				{#if update.error}
					<p class="text-error-ink">{update.error}</p>
				{/if}

				{#if update.has_update}
					<p class="text-fg-muted">
						发布于 {update.published_at || '未知'} · {size(update.size)}
						{#if update.release_url}
							·
							<a
								class="text-primary hover:underline"
								href={update.release_url}
								target="_blank"
								rel="noreferrer"
							>
								查看发布说明
							</a>
						{/if}
					</p>

					{#if !update.allow_replace}
						<p class="text-warning-ink">
							更新源已就绪但未开启自动替换（<code class="font-mono">UPDATE_ALLOW_REPLACE</code>）。
							应用后只会下载并校验到本地，不会替换正在运行的程序。
						</p>
					{:else}
						<p class="text-warning-ink">
							应用后当前进程会退出，需要由 systemd 之类的进程管理器拉起。
							程序会在替换前自动备份当前版本，迁移失败会回滚。
						</p>
					{/if}

					<div>
						<Button disabled={applying} onclick={() => (confirmOpen = true)}>
							{applying ? '更新中…' : `更新到 ${update.latest_version}`}
						</Button>
					</div>
				{/if}

				<p class="text-[12px] text-fg-faint">
					更新源：<span class="font-mono">{update.source}</span> · 产物：<span class="font-mono"
						>{update.asset_name}</span
					>
				</p>
			</div>
		{/if}
	</Panel>
</div>

<ConfirmDialog
	visible={confirmOpen}
	title="应用更新"
	message={update?.allow_replace
		? `确认把后端更新到 ${update.latest_version}？当前进程会退出并由进程管理器重启，期间所有客户端会短暂断开。程序会自动备份旧版本，迁移失败会回滚。`
		: `确认下载 ${update?.latest_version}？当前配置不会替换正在运行的程序，只会下载并校验到 update/ 目录。`}
	confirmText={applying ? '更新中…' : '确认更新'}
	danger={update?.allow_replace}
	onconfirm={() => void apply()}
	onclose={() => (confirmOpen = false)}
/>
