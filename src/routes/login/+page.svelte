<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { auth } from '$lib/stores/auth.svelte';
	import { feedback } from '$lib/stores/feedback.svelte';
	import { api } from '$lib/api/client';
	import Icon from '$lib/components/Icon.svelte';

	let username = $state('');
	let password = $state('');
	let displayName = $state('');
	let submitting = $state(false);
	let error = $state('');

	/**
	 * 系统是否还没有任何账号。
	 *
	 * 全新部署时用户表是空的，登录表单永远登不进去。与其让用户对着一个
	 * 必然失败的表单发呆，不如直接换成「创建首个管理员」。
	 *
	 * null 表示还没问出结果（保持登录表单，避免闪烁）。
	 */
	let needsBootstrap = $state<boolean | null>(null);

	onMount(() => {
		// Idempotent: whichever of the layout/login mounts first kicks this off.
		void auth.restore();
		void api
			.bootstrapStatus()
			.then((r) => {
				needsBootstrap = r.needs_bootstrap;
			})
			.catch(() => {
				// 问不到就按普通登录处理，不影响已有部署。
				needsBootstrap = false;
			});
	});

	// Already signed in (e.g. hitting /login with a live session).
	$effect(() => {
		if (!auth.loading && auth.user) {
			void goto(resolve('/'), { replaceState: true });
		}
	});

	async function submit() {
		if (submitting) return;
		if (!username.trim() || !password) {
			error = '请输入用户名和密码';
			return;
		}

		submitting = true;
		error = '';
		try {
			if (needsBootstrap) await bootstrap();
			else {
				const user = await auth.login(username.trim(), password);
				feedback.success(`欢迎回来，${user.display_name || user.username}`);
			}
			await goto(resolve('/'), { replaceState: true });
		} catch (err) {
			error = err instanceof Error ? err.message : needsBootstrap ? '创建失败' : '登录失败';
		} finally {
			submitting = false;
		}
	}

	/**
	 * 创建首个管理员，然后直接登录。
	 *
	 * 后端在用户表为空时会把第一个注册的人固定为管理员，并忽略传入的 role；
	 * 建好之后该接口立刻收紧为「仅管理员可调用」，所以这里不需要传 role。
	 */
	async function bootstrap() {
		await api.register({
			username: username.trim(),
			password,
			display_name: displayName.trim() || username.trim()
		});
		// 再走一次登录拿令牌——注册接口不返回 token。
		const user = await auth.login(username.trim(), password);
		feedback.success(`管理员 ${user.display_name || user.username} 创建成功`);
	}

	const inputClass =
		'h-11 w-full rounded-[var(--radius-form)] border border-border bg-bg-surface px-3.5 pl-10 text-[13.5px] text-fg transition-colors placeholder:text-fg-faint hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none disabled:bg-bg-overlay disabled:text-fg-faint';
</script>

<svelte:head>
	<title>登录 - 管理后台</title>
</svelte:head>

<div class="flex min-h-screen bg-bg-base">
	<!-- Brand rail: the console's identity lives here so the form stays quiet. -->
	<div
		class="relative hidden w-[46%] max-w-[560px] flex-col justify-between overflow-hidden bg-gradient-to-br from-primary-800 via-primary to-primary-700 p-12 text-white lg:flex"
	>
		<div
			class="pointer-events-none absolute inset-0 opacity-[0.14]"
			style="background-image:linear-gradient(rgba(255,255,255,.6) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.6) 1px,transparent 1px);background-size:44px 44px;"
		></div>
		<div
			class="pointer-events-none absolute -top-28 -right-24 h-[420px] w-[420px] rounded-full bg-white/10 blur-3xl"
		></div>

		<div class="relative flex items-center gap-3">
			<span
				class="flex h-10 w-10 items-center justify-center rounded-[11px] bg-white/15 ring-1 ring-white/25 backdrop-blur"
			>
				<Icon name="overview" size={19} strokeWidth={1.9} />
			</span>
			<div>
				<div class="text-[14px] leading-tight font-semibold tracking-[-0.01em]">融媒运营中心</div>
				<div class="mt-0.5 text-[11px] text-white/70">校园直播导播协调系统</div>
			</div>
		</div>

		<div class="relative">
			<h2 class="max-w-[16em] text-[30px] leading-[1.28] font-semibold tracking-[-0.02em]">
				导播预判、解说同步、包装联动，<br />一条链路全部留痕。
			</h2>
			<ul class="mt-9 space-y-3.5 text-[13px] text-white/80">
				<li class="flex items-center gap-2.5">
					<span class="flex h-5 w-5 items-center justify-center rounded-full bg-white/15">
						<Icon name="check" size={12} strokeWidth={2.2} />
					</span>
					控制权互斥与心跳释放，避免双导播误切
				</li>
				<li class="flex items-center gap-2.5">
					<span class="flex h-5 w-5 items-center justify-center rounded-full bg-white/15">
						<Icon name="check" size={12} strokeWidth={2.2} />
					</span>
					下一项推送与确认已切，解说提前进入状态
				</li>
				<li class="flex items-center gap-2.5">
					<span class="flex h-5 w-5 items-center justify-center rounded-full bg-white/15">
						<Icon name="check" size={12} strokeWidth={2.2} />
					</span>
					完整日志与插件归档，赛后直接复盘
				</li>
			</ul>
		</div>

		<div class="relative flex items-center gap-2 text-[11px] text-white/60">
			<span class="flex h-1.5 w-1.5 rounded-full bg-emerald-300"></span>
			服务运行正常 · 局域网内部署
		</div>
	</div>

	<!-- Sign-in form. -->
	<div class="flex flex-1 items-center justify-center px-5 py-10">
		<div class="w-full max-w-[360px]">
			<div class="mb-8 flex items-center gap-3 lg:hidden">
				<span
					class="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-blue-500 to-indigo-600 text-white"
				>
					<Icon name="overview" size={17} strokeWidth={1.9} />
				</span>
				<div>
					<div class="text-[13.5px] font-semibold text-fg">融媒运营中心</div>
					<div class="text-[11px] text-fg-muted">校园直播管理平台</div>
				</div>
			</div>

			{#if needsBootstrap}
				<!-- 全新部署：还没有任何账号，登录必然失败，直接引导创建管理员 -->
				<div
					class="mb-5 flex items-start gap-2.5 rounded-[var(--radius-form)] border border-warning-line bg-warning-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-warning-ink"
				>
					<Icon name="alert" size={15} class="mt-px shrink-0" />
					<span>
						系统尚未初始化，<b>还没有任何账号</b>。下面创建的第一个账号即为管理员。
					</span>
				</div>
			{/if}

			<h1 class="text-[21px] font-semibold tracking-[-0.015em] text-fg">
				{needsBootstrap ? '创建管理员账号' : '登录管理后台'}
			</h1>
			<p class="mt-1.5 text-[13px] text-fg-muted">
				{#if needsBootstrap}
					这是全新部署，创建完成后该入口会自动关闭。
				{:else}
					使用管理员或导播账号继续。
				{/if}
			</p>

			<form
				onsubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
				class="mt-8 space-y-4"
			>
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-medium text-fg">用户名</span>
					<span class="relative">
						<Icon
							name="users"
							size={16}
							class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-faint"
						/>
						<input
							type="text"
							bind:value={username}
							placeholder={needsBootstrap ? '建议用 admin' : '请输入用户名'}
							autocomplete="username"
							disabled={submitting}
							class={inputClass}
						/>
					</span>
				</label>

				<label class="block">
					<span class="mb-1.5 block text-[12px] font-medium text-fg">密码</span>
					<span class="relative">
						<Icon
							name="assign"
							size={16}
							class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-faint"
						/>
						<input
							type="password"
							bind:value={password}
							placeholder={needsBootstrap ? '至少 6 位' : '请输入密码'}
							autocomplete={needsBootstrap ? 'new-password' : 'current-password'}
							disabled={submitting}
							class={inputClass}
						/>
					</span>
				</label>

				{#if needsBootstrap}
					<label class="block">
						<span class="mb-1.5 block text-[12px] font-medium text-fg">
							显示名 <span class="font-normal text-fg-faint">（可选）</span>
						</span>
						<span class="relative">
							<Icon
								name="overview"
								size={16}
								class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-faint"
							/>
							<input
								type="text"
								bind:value={displayName}
								placeholder="留空则与用户名相同"
								autocomplete="name"
								disabled={submitting}
								class={inputClass}
							/>
						</span>
					</label>
				{/if}

				{#if error}
					<div
						class="flex items-start gap-2 rounded-[var(--radius-form)] border border-error-line bg-error-soft px-3 py-2.5 text-[12.5px] text-error-ink"
					>
						<Icon name="alert" size={15} class="mt-px shrink-0" />
						<span>{error}</span>
					</div>
				{/if}

				<button
					type="submit"
					disabled={submitting}
					class="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-form)] bg-primary text-[14px] font-semibold text-white shadow-control transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
				>
					{#if submitting}
						<span class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
						></span>
						{needsBootstrap ? '创建中...' : '登录中...'}
					{:else}
						{needsBootstrap ? '创建并进入后台' : '登录'}
					{/if}
				</button>
			</form>

			<p class="mt-8 text-[11.5px] leading-relaxed text-fg-faint">
				{#if needsBootstrap}
					创建后请尽快在「用户管理」中为导播分配账号，并确认服务器端口不对公网开放
					——初始化完成前，创建管理员的接口是公开的。
				{:else}
					账号由系统管理员在「用户管理」中创建。忘记密码请直接在服务器上重新初始化管理员账号。
				{/if}
			</p>

			<!-- 备案号与版权：按备案要求放在登录页显著位置 -->
			<p class="mt-6 border-t border-border pt-4 text-[11px] leading-relaxed text-fg-faint">
				Copyright © {new Date().getFullYear()} 烧瑚烙饼 版权所有 ·
				<a
					href="https://beian.miit.gov.cn/"
					target="_blank"
					rel="noopener nofollow"
					class="transition-colors hover:text-primary-ink hover:underline">蜀ICP备2025120814号-1</a
				>
			</p>
		</div>
	</div>
</div>
