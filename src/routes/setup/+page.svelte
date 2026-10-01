<script lang="ts">
	/**
	 * 初始化向导。
	 *
	 * 全新部署时后端只有一个空数据库，除 /api/setup/* 外的接口全部 503。这个页面
	 * 是拿到一个可用系统的唯一入口，所以它必须：
	 *
	 *   1. 不依赖任何登录态（此刻系统里一个账号都没有）；
	 *   2. 把要写进 .env 的东西一次问清楚（系统名称、对外地址、监听地址与端口）；
	 *   3. 顺手创建第一个管理员账号（固定为超级管理员）。
	 *
	 * 提交后后端会写好 .env、跑完迁移、建好账号。改动监听地址/端口需要重启后端
	 * 才生效，这一点会在结果页明确写出来——否则用户会以为「改了没反应」。
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '$lib/api/client';
	import { auth } from '$lib/stores/auth.svelte';
	import { feedback } from '$lib/stores/feedback.svelte';
	import { setup } from '$lib/stores/setup.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Button from '$lib/components/Button.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import Field from '$lib/components/Field.svelte';
	import type { SetupApplyResult } from '$lib/api/types';

	// ---- 表单状态 ----
	let appName = $state('');
	let appUrl = $state('');
	let appHost = $state('0.0.0.0');
	let appPort = $state('3000');

	let username = $state('admin');
	let displayName = $state('系统管理员');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');

	// ---- 页面状态 ----
	let loading = $state(true);
	let submitting = $state(false);
	let entering = $state(false);
	let error = $state('');
	let loadError = $state('');
	let result = $state<SetupApplyResult | null>(null);

	const status = $derived(setup.status);

	onMount(async () => {
		const snapshot = await setup.check(true);
		loading = false;

		if (!snapshot) {
			loadError = '读不到后端状态。请确认后端已启动，并且本页面与后端同源。';
			return;
		}
		if (!snapshot.needs_setup) {
			// 已初始化：可能是别人已经建好了，也可能是重复打开这个地址。
			return;
		}

		appName = snapshot.defaults.app_name;
		appUrl = snapshot.defaults.app_url;
		appHost = snapshot.defaults.app_host;
		appPort = snapshot.defaults.app_port;

		// 这是局域网系统：各端（导播/解说/采访）都在别的机器上，只听 127.0.0.1
		// 等于装完谁也连不上。所以当 .env 里还是回环地址、又确实探测到内网 IP 时，
		// 默认值改成「监听全部网卡 + 内网地址」；用户仍可在下拉里改回去。
		if (appHost === '127.0.0.1' && snapshot.lan_ip) {
			appHost = '0.0.0.0';
			if (/127\.0\.0\.1|localhost/.test(appUrl)) {
				appUrl = `http://${snapshot.lan_ip}:${snapshot.defaults.app_port}`;
			}
		}

		username = snapshot.defaults.admin_username;
		displayName = snapshot.defaults.admin_display_name;
	});

	/**
	 * 只有「还没初始化」时才存在的部署细节。
	 *
	 * 后端在已初始化后不再下发这些字段（setup_controller.go 的 Status），
	 * 而 Svelte 模板不做类型收窄——`{#if status.needs_setup}` 里的
	 * `status.database.path` 编译器是管不着的。所以在这里收窄一次，
	 * 模板统一读 details，字段缺失就会在 svelte-check 里报出来。
	 */
	const details = $derived(status?.needs_setup ? status : null);

	/** 监听地址可选项：两个常用值 + 后端探测到的当前值。 */
	const hostOptions = $derived.by(() => {
		// 不用 Set：Svelte 的 ESLint 规则要求响应式代码里用 SvelteSet，
		// 而这里最多三个元素，数组去重更直白。
		const values = ['0.0.0.0', '127.0.0.1'];
		const current = details?.defaults.app_host?.trim();
		if (current && !values.includes(current)) values.push(current);
		return values;
	});

	const hostHint = $derived(
		appHost === '0.0.0.0'
			? '监听全部网卡，局域网内的导播端、解说端、采访端都能连上。'
			: appHost === '127.0.0.1'
				? '只有本机能访问，其他机器连不上。仅建议先在部署机上试跑。'
				: `只在 ${appHost} 上监听。`
	);

	/**
	 * 表单是否还能提交：.env 不可写时提前挡住，别让用户白填一遍。
	 *
	 * 读 details 而不是 status：details 为 null 就意味着后端没给部署细节，
	 * 那种情况下不该把按钮禁掉——真正要拦的是「后端明确说了不可写」。
	 */
	const envWritable = $derived(details?.env.writable !== false);

	function validate(): string {
		if (!appName.trim()) return '请填写系统名称';
		if ([...appName.trim()].length > 60) return '系统名称不能超过 60 个字符';
		if (!/^https?:\/\/\S+$/.test(appUrl.trim())) return '访问地址要以 http:// 或 https:// 开头';
		const port = Number(appPort);
		if (!Number.isInteger(port) || port < 1 || port > 65535) return '端口必须是 1-65535 之间的整数';
		if (!/^[\w.\-\u4e00-\u9fff]{1,64}$/.test(username.trim())) {
			return '用户名只能包含字母、数字、下划线、点、短横线与中文，且不超过 64 个字符';
		}
		if (password.length < 6) return '密码至少 6 位';
		if (password !== confirmPassword) return '两次输入的密码不一致';
		if (email.trim() && !/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(email.trim())) {
			return '邮箱格式不正确';
		}
		return '';
	}

	async function submit() {
		if (submitting) return;
		const problem = validate();
		if (problem) {
			error = problem;
			return;
		}

		error = '';
		submitting = true;
		try {
			result = await api.setupApply({
				app_name: appName.trim(),
				app_url: appUrl.trim().replace(/\/+$/, ''),
				app_host: appHost,
				app_port: appPort,
				admin_username: username.trim(),
				admin_password: password,
				admin_display_name: displayName.trim(),
				admin_email: email.trim()
			});
			// 让布局知道初始化已经结束，别再把人送回这个页面。
			setup.markDone();
			feedback.success('初始化完成');
		} catch (err) {
			error = err instanceof Error ? err.message : '初始化失败，请查看后端日志';
		} finally {
			submitting = false;
		}
	}

	/** 用刚建好的账号登录并进入后台。 */
	async function enter() {
		if (entering) return;
		entering = true;
		try {
			await auth.login(username.trim(), password);
			await goto(resolve('/'), { replaceState: true });
		} catch (err) {
			// 登录失败不代表初始化失败（比如重启后令牌密钥变了），
			// 退回登录页让人手工登即可。
			feedback.error(err instanceof Error ? err.message : '自动登录失败，请手动登录');
			entering = false;
		}
	}
</script>

<svelte:head>
	<title>系统初始化 - 管理后台</title>
</svelte:head>

<div class="min-h-screen bg-bg-base">
	<header class="border-b border-border bg-bg-surface">
		<div class="mx-auto flex h-14 max-w-[720px] items-center gap-3 px-5">
			<span
				class="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-blue-500 to-indigo-600 text-white"
			>
				<Icon name="settings" size={16} strokeWidth={1.9} />
			</span>
			<div class="min-w-0">
				<div class="text-[13px] leading-tight font-semibold text-fg">系统初始化</div>
				<div class="text-[11px] text-fg-muted">绵中融媒体智汇导播系统 · 首次部署向导</div>
			</div>
			{#if status?.version}
				<span class="ml-auto text-[11px] text-fg-faint">v{status.version}</span>
			{/if}
		</div>
	</header>

	<main class="mx-auto max-w-[720px] px-5 py-8">
		{#if loading}
			<div class="flex items-center justify-center gap-2 py-24 text-[13px] text-fg-muted">
				<span class="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary"
				></span>
				正在读取系统状态…
			</div>
		{:else if loadError}
			<Panel title="无法读取系统状态">
				<div class="space-y-4">
					<div
						class="flex items-start gap-2 rounded-[var(--radius-form)] border border-error-line bg-error-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-error-ink"
					>
						<Icon name="alert" size={15} class="mt-px shrink-0" />
						<span>{loadError}</span>
					</div>
					<div class="flex gap-2">
						<Button variant="primary" icon="refresh" onclick={() => location.reload()}>
							重新加载
						</Button>
						<a
							href={resolve('/login')}
							class="inline-flex h-9 items-center rounded-[var(--radius-form)] border border-border px-3.5 text-[12.5px] font-medium text-fg-muted transition-colors hover:bg-bg-overlay hover:text-fg"
							>去登录页</a
						>
					</div>
				</div>
			</Panel>
		{:else if result}
			<!-- 成功页：把写进 .env 的内容与接下来要做的事摊开说清楚。
			     必须排在 !needs_setup 分支之前：提交成功时后台状态已经翻成
			     「已初始化」，否则用户刚点完按钮就被切到「已完成初始化」的提示页，
			     看不到刚写了哪些配置、要不要重启。 -->
			<div class="space-y-5">
				<div
					class="flex items-start gap-3 rounded-[var(--radius-box)] border border-success-ink/20 bg-success-soft px-4 py-3.5"
				>
					<span
						class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success text-white"
					>
						<Icon name="check" size={14} strokeWidth={2.4} />
					</span>
					<div class="min-w-0">
						<div class="text-[13.5px] font-semibold text-success-ink">初始化完成</div>
						<div class="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
							管理员账号 <b>{result.admin.username}</b> 已创建（{result.admin.role_label}），
							配置文件已更新。
						</div>
					</div>
				</div>

				<Panel title="已写入的配置" description={result.env_path}>
					<dl class="grid grid-cols-1 gap-x-6 gap-y-2.5 text-[12.5px] sm:grid-cols-[110px_1fr]">
						<dt class="text-fg-muted">系统名称</dt>
						<dd class="break-words text-fg">{appName}</dd>
						<dt class="text-fg-muted">访问地址</dt>
						<dd class="break-all text-fg">{result.app_url}</dd>
						<dt class="text-fg-muted">WebSocket</dt>
						<dd class="break-all text-fg">{result.ws_url}</dd>
						<dt class="text-fg-muted">改动项</dt>
						<dd class="break-words text-fg">
							{result.env_written.length ? result.env_written.join('、') : '（本次无需新增）'}
						</dd>
					</dl>
				</Panel>

				{#if result.notes.length || result.restart_required}
					<Panel title="接下来">
						<ul class="space-y-2 text-[12.5px] leading-relaxed text-fg-muted">
							{#each result.notes as note (note)}
								<li class="flex items-start gap-2">
									<Icon name="activity" size={14} class="mt-0.5 shrink-0 text-fg-faint" />
									<span>{note}</span>
								</li>
							{/each}
						</ul>
						{#if result.restart_required}
							<div
								class="mt-4 flex items-start gap-2 rounded-[var(--radius-form)] border border-warning-line bg-warning-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-warning-ink"
							>
								<Icon name="alert" size={15} class="mt-px shrink-0" />
								<span>
									监听地址或端口有变动，需要<b>重启后端服务</b
									>才会生效。重启前请先按下方按钮进入后台， 把导播账号与项目建好。
								</span>
							</div>
						{/if}
					</Panel>
				{/if}

				<div class="flex flex-wrap gap-2">
					<Button variant="primary" icon="check" loading={entering} onclick={() => void enter()}>
						登录并进入后台
					</Button>
					<a
						href={resolve('/login')}
						class="inline-flex h-9 items-center rounded-[var(--radius-form)] border border-border px-3.5 text-[12.5px] font-medium text-fg-muted transition-colors hover:bg-bg-overlay hover:text-fg"
						>手动登录</a
					>
				</div>
			</div>
		{:else if !status?.needs_setup}
			<!-- 直接打开这个地址但系统早就初始化好了：不让人对着表单空填一遍。 -->
			<Panel title="系统已完成初始化">
				<div class="space-y-4 text-[12.5px] leading-relaxed text-fg-muted">
					<p>
						当前数据库已经可用，初始化向导不再放行。如果这是刚刚完成的初始化，请直接登录管理后台。
					</p>
					<a
						href={resolve('/login')}
						class="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-form)] bg-primary px-4 text-[12.5px] font-semibold text-white transition-colors hover:bg-primary-700"
					>
						<Icon name="check" size={15} />
						前往登录
					</a>
				</div>
			</Panel>
		{:else}
			<div class="space-y-5">
				<div
					class="flex items-start gap-2.5 rounded-[var(--radius-form)] border border-warning-line bg-warning-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-warning-ink"
				>
					<Icon name="alert" size={15} class="mt-px shrink-0" />
					<span>
						检测到<b>数据库尚未创建</b>，系统处于初始化模式：除了本页，其他接口暂时不可用。
						填完下面的内容即可完成初始化，无需手工编辑 .env 或敲命令行。
					</span>
				</div>

				<form
					onsubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
					class="space-y-5"
				>
					<Panel title="系统信息" description="会写入后端 .env，重启后仍需保持一致。">
						<div class="space-y-4">
							<Field
								label="系统名称"
								bind:value={appName}
								required
								placeholder="绵中融媒体智汇导播系统"
							/>
							<Field
								label="对外访问地址"
								bind:value={appUrl}
								required
								placeholder="http://192.168.1.10:3000"
								hint="各端（导播端 / 解说端 / 采访端）都从这里取服务器地址。局域网部署填内网 IP；走了反向代理就填域名。"
							/>

							<div class="grid gap-4 sm:grid-cols-2">
								<label class="block">
									<span class="mb-1.5 block text-[12px] font-medium text-fg">
										监听地址<span class="text-error">*</span>
									</span>
									<select
										bind:value={appHost}
										disabled={submitting}
										class="h-10 w-full cursor-pointer rounded-[var(--radius-form)] border border-border bg-bg-surface px-3 text-[13px] text-fg transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none disabled:bg-bg-overlay disabled:text-fg-faint"
									>
										{#each hostOptions as host (host)}
											<option value={host}>{host}</option>
										{/each}
									</select>
									<span class="mt-1.5 block text-[11.5px] text-fg-faint">{hostHint}</span>
								</label>

								<Field
									label="监听端口"
									bind:value={appPort}
									required
									type="number"
									hint="默认 3000。"
								/>
							</div>
						</div>
					</Panel>

					<Panel title="数据库" description="初始化时会自动建库、建表并跑完所有迁移。">
						<div class="space-y-2 text-[12.5px] leading-relaxed">
							<div class="flex flex-wrap items-center gap-2">
								<span
									class="rounded-[var(--radius-form)] border border-border bg-bg-overlay px-2 py-1 font-mono text-[11.5px] text-fg"
								>
									{status.database.connection} · {status.database.path}
								</span>
								{#if status.database.missing_at_startup}
									<span class="text-fg-faint">启动时不存在，将在初始化时创建</span>
								{/if}
							</div>
							<p class="text-fg-faint">
								SQLite 单文件数据库，随发布包目录一起备份即可。路径可在 .env 的
								<code>DB_DATABASE</code> 里修改（改完需重启）。
							</p>
						</div>
					</Panel>

					<Panel
						title="管理员账号"
						description="第一个账号固定为超级管理员；它是之后分配角色、系统更新的唯一入口。"
					>
						<div class="space-y-4">
							<div class="grid gap-4 sm:grid-cols-2">
								<Field label="用户名" bind:value={username} required placeholder="admin" />
								<Field label="显示名" bind:value={displayName} placeholder="系统管理员" />
							</div>
							<Field
								label="邮箱（可选）"
								bind:value={email}
								type="email"
								placeholder="admin@example.com"
								hint="仅用于取头像（WeAvatar）。留空则显示首字母圆圈。"
							/>
							<div class="grid gap-4 sm:grid-cols-2">
								<Field
									label="密码"
									bind:value={password}
									type="password"
									required
									placeholder="至少 6 位"
									hint="至少 6 位。"
								/>
								<Field label="确认密码" bind:value={confirmPassword} type="password" required />
							</div>
						</div>
					</Panel>

					{#if error}
						<div
							class="flex items-start gap-2 rounded-[var(--radius-form)] border border-error-line bg-error-soft px-3 py-2.5 text-[12.5px] text-error-ink"
						>
							<Icon name="alert" size={15} class="mt-px shrink-0" />
							<span>{error}</span>
						</div>
					{/if}

					{#if !envWritable}
						<div
							class="flex items-start gap-2 rounded-[var(--radius-form)] border border-error-line bg-error-soft px-3 py-2.5 text-[12.5px] text-error-ink"
						>
							<Icon name="alert" size={15} class="mt-px shrink-0" />
							<span>
								后端无法写入 <code>{status.env.abs_path}</code
								>，请检查该文件与所在目录的权限后重启后端。
							</span>
						</div>
					{/if}

					<div class="flex flex-wrap items-center gap-3">
						<Button
							type="submit"
							variant="primary"
							loading={submitting}
							disabled={!envWritable}
							icon="check"
						>
							完成初始化
						</Button>
						<span class="text-[11.5px] text-fg-faint">
							提交后会写入 .env、建库建表，并创建管理员账号。
						</span>
					</div>
				</form>
			</div>
		{/if}
	</main>
</div>
