<script lang="ts">
	/**
	 * 系统设置：运行环境 + 在线更新。仅超级管理员可见。
	 *
	 * 页面上会替换服务自身的可执行文件并让进程重启，所以确认环节做得很重：
	 * 必须先「检查更新」，看清目标版本，再点「应用」——应用时还要再确认一次，
	 * 并显式带上刚看到的版本号。后端会比对该版本号，避免「检查时是 1.2.0、
	 * 应用时装上 1.3.0」。
	 */
	import { onMount, onDestroy } from 'svelte';
	import { api } from '$lib/api/client';
	import type {
		HealthStatus,
		SystemInfo,
		UpdateProgress,
		UpdateStage,
		UpdateStatus
	} from '$lib/api/types';
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
	let progress = $state<UpdateProgress | null>(null);

	let loading = $state(true);
	let checking = $state(false);
	let applying = $state(false);
	let confirmOpen = $state(false);

	/** 轮询进度用的定时器。空闲时必须是 null，否则会一直空转打接口。 */
	let pollTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * 阶段 → 给运维看的中文名。
	 *
	 * 写死在前端而不是让后端下发：这些词是界面语言，不是运行时状态。
	 * 后端下发的话换一次界面文案就得发一次版。
	 */
	const STAGE_LABELS: Record<UpdateStage, string> = {
		idle: '空闲',
		fetching: '查询更新源',
		downloading: '下载中',
		verifying: '校验 sha256',
		extracting: '解压可执行文件',
		replacing: '备份并替换程序',
		migrating: '执行数据库迁移',
		finished: '已完成',
		failed: '失败'
	};

	/** 有任务在跑（含刚失败还没重新发起的那次）。决定要不要显示进度面板。 */
	const running = $derived(
		progress !== null &&
			progress.stage !== 'idle' &&
			progress.stage !== 'finished' &&
			!progress.failed
	);

	/**
	 * 正在重启：替换已经完成，但进程还没退。
	 *
	 * 这一段界面拿不到任何来自服务端的响应——连接会直接被掐断。所以不能
	 * 靠「请求失败」来判断，只能自己进入这个状态并轮询 /api/status，
	 * 等服务重新起来为止。
	 */
	const restarting = $derived(progress?.stage === 'finished' && progress.result?.replaced === true);

	/**
	 * 下载速度（字节/秒）。
	 *
	 * 只在下载阶段有意义，其余阶段 done 不再变化，算出来的速度是 0。
	 * 采样点是上一次轮询，所以第一次拿到进度时算不出速度——显示不出来
	 * 比显示一个假数字好。
	 */
	let speed = $state<number | null>(null);
	let lastSample: { done: number; at: number } | null = null;

	function computeSpeed(next: UpdateProgress): number | null {
		const now = Date.now();
		if (next.stage !== 'downloading' || next.total <= 0) {
			lastSample = null;
			return null;
		}
		const prev = lastSample;
		lastSample = { done: next.done, at: now };
		if (!prev) return null;
		const dt = (now - prev.at) / 1000;
		// 间隔太短时字节差可能是 0，算出来的速度会离谱地大或除出噪声。
		if (dt < 0.2) return null;
		return Math.max(0, (next.done - prev.done) / dt);
	}

	function humanBytes(n: number): string {
		if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
		if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
		return `${n} B`;
	}

	function stopPolling() {
		if (pollTimer) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
	}

	/**
	 * 轮询一次进度并决定要不要继续。
	 *
	 * 串行而不是 setInterval：上一次请求还没回来就不该再发一次——更新期间
	 * 服务本身正忙，堆积请求只会让它更慢。
	 */
	async function pollOnce(): Promise<void> {
		try {
			const next = await api.updateProgress();
			progress = next;
			const s = computeSpeed(next);
			if (s !== null) speed = s;

			if (next.finished && !next.failed) {
				stopPolling();
				if (next.result?.replaced) {
					// 进程即将退出，接下来只能靠 /api/status 探活。
					startHealthPoll();
					return;
				}
				feedback.success(`新版本 ${next.result?.version ?? ''} 已下载并校验通过`);
				confirmOpen = false;
				return;
			}
			if (next.failed) {
				stopPolling();
				feedback.error(next.error || '更新失败');
				return;
			}
			pollTimer = setTimeout(() => void pollOnce(), 800);
		} catch (err) {
			// 请求失败本身也是信息：可能正在重启、也可能网络断了。
			// 两种都不该立刻判定失败放弃，否则用户会以为更新失败了。
			if (restarting) return;
			stopPolling();
			feedback.error(err instanceof Error ? err.message : '获取更新进度失败');
		}
	}

	/**
	 * 替换完成后探活，等服务重新起来。
	 *
	 * 这是整个流程里唯一「服务端完全不响应」的窗口，只能靠反复试 /api/status
	 * 来判断重启结束。设上限是为了避免 systemd 没能拉起时永远转圈。
	 */
	let healthTimer: ReturnType<typeof setTimeout> | null = null;
	let healthTries = 0;

	function startHealthPoll() {
		healthTries = 0;
		const tick = async () => {
			healthTries += 1;
			try {
				await api.health();
				if (healthTimer) clearTimeout(healthTimer);
				healthTimer = null;
				feedback.success('服务已恢复运行');
				await load();
				return;
			} catch {
				if (healthTries >= 30) {
					if (healthTimer) clearTimeout(healthTimer);
					healthTimer = null;
					feedback.error('服务 30 次探测都没响应，请检查进程管理器与启动日志');
					return;
				}
			}
			healthTimer = setTimeout(() => void tick(), 2000);
		};
		void tick();
	}

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
			await api.applyUpdate(update.latest_version);
			// 后端已立刻返回，真正的结果要靠轮询。
			confirmOpen = false;
			speed = null;
			lastSample = null;
			progress = {
				stage: 'fetching',
				done: 0,
				total: 0,
				percent: 0,
				finished: false,
				failed: false,
				started_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			};
			void pollOnce();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '启动更新失败');
		} finally {
			applying = false;
		}
	}

	onMount(() => void load());

	onDestroy(() => {
		stopPolling();
		if (healthTimer) clearTimeout(healthTimer);
	});
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

				<!--
					镜像。校园网里最常见的故障就是这一条：api.github.com 有时能通，
					所以「检查更新」显示一切正常，但资产要走 github.com 的下载
					域名，那个域名经常被 TCP 阻断——表现为一键更新就卡死。
					没配镜像时明确说出来，让人能立刻对症下药。
				-->
				<!--
					镜像与校验值来源。校园网里最常见的故障就是第一条：api.github.com
					有时能通，所以「检查更新」显示一切正常，但资产要走 github.com 的
					下载域名，那个域名经常被 TCP 阻断——表现为一键更新就卡死。
				-->
				<div class="space-y-1 text-[12px] text-fg-faint">
					<p>
						下载镜像：{#if update.download_mirror}<span class="font-mono"
								>{update.download_mirror}</span
							>{:else}<span class="text-warning-ink"
								>未配置（直连 GitHub，校园网内可能无法下载）</span
							>{/if}
					</p>
					<p>
						校验值来源：{#if update.checksum_url}<span class="font-mono">{update.checksum_url}</span
							>{:else}<span class="text-warning-ink">跟随下载源</span>{/if}
					</p>
					{#if update.download_mirror && !update.checksum_url}
						<!--
							这两条必须一起说：校验和与包来自同一处，攻破镜像就能同时替换
							两者，sha256 校验形同虚设。不提示的话，运维会以为配了镜像就等于
							「更新仍然是可信的」。
						-->
						<p class="text-warning-ink">
							注意：校验值与安装包来自同一处，镜像若被篡改即可同时替换两者，完整性校验会一并失效。
							需要真正的校验请配置 <code class="font-mono">UPDATE_CHECKSUM_URL</code> 指向独立可信源。
						</p>
					{/if}
				</div>
			</div>
		{/if}
	</Panel>

	<!--
		进度面板。与上面的「可更新」区块分开，因为它的出现条件不同：
		有任务在跑、刚失败、或者正在等服务重启——这三种都不是「有可用更新」。
		Panel 不接受 class，间距靠外层这个 div 给。
	-->
	{#if progress && progress.stage !== 'idle'}
		<div class="mt-4">
			<Panel
				title="更新进度"
				description={restarting
					? '替换已完成，服务正在重启。等待期间客户端会短暂断开，属正常现象。'
					: progress.message || STAGE_LABELS[progress.stage]}
			>
				<div class="space-y-3">
					<div class="flex items-center justify-between gap-3 text-[12.5px]">
						<span class="text-fg-muted">{STAGE_LABELS[progress.stage]}</span>
						{#if progress.stage === 'downloading' && progress.total > 0}
							<span class="font-mono text-fg">
								{humanBytes(progress.done)} / {humanBytes(progress.total)}
								{#if speed !== null}
									· {humanBytes(speed)}/s
								{/if}
							</span>
						{:else if progress.total > 0 && progress.stage !== 'failed'}
							<span class="font-mono text-fg">{progress.percent.toFixed(0)}%</span>
						{:else if progress.stage === 'downloading'}
							<!--
								连接刚建立、第一块数据还没到，total 仍是 0。
								这时显示 0% 会被读成「下载卡住了」，不如明说在等首包。
							-->
							<span class="text-fg-faint">正在建立连接…</span>
						{/if}
					</div>

					<!--
					进度条本身。失败态保留一条红色满格而不是空条：空条会让人
					以为「还没开始」，而实际已经结束了。
				-->
					<div
						class="h-2 w-full overflow-hidden rounded-full bg-bg-surface"
						role="progressbar"
						aria-valuenow={progress.percent}
						aria-valuemin="0"
						aria-valuemax="100"
					>
						<div
							class="h-full rounded-full transition-[width] duration-300 ease-out {progress.failed
								? 'bg-error'
								: restarting
									? 'bg-success'
									: 'bg-primary'}"
							style="width: {progress.failed ? 100 : progress.percent}%"
						></div>
					</div>

					{#if progress.failed}
						<p class="text-[12.5px] text-error-ink">
							更新失败：{progress.error ?? '未知原因'}
						</p>
					{/if}

					{#if progress.steps?.length}
						<!--
						执行日志。放在 <details> 里是因为它平时没人看，
						但真出问题时它就是唯一的线索（下载了多久、校验有没有过、
						备份写到哪），必须能翻出来。
					-->
						<details class="text-[12px]">
							<summary class="cursor-pointer text-fg-muted">
								执行日志（{progress.steps.length} 条）
							</summary>
							<ul class="mt-2 space-y-0.5 font-mono text-[11px] text-fg-faint">
								{#each progress.steps as step, i (i)}
									<li>{step}</li>
								{/each}
							</ul>
						</details>
					{/if}

					{#if progress.result?.backup_path}
						<p class="font-mono text-[11px] text-fg-faint">
							旧版本备份：{progress.result.backup_path}
						</p>
					{/if}
				</div>
			</Panel>
		</div>
	{/if}
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
