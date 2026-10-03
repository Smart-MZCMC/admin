<script lang="ts">
	/**
	 * Global chrome. The login and setup routes render bare; every other route
	 * gets the top bar plus tab navigation.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import '../app.css';
	import ToastHost from '$lib/components/ToastHost.svelte';
	import AppShell from '$lib/components/AppShell.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { setup } from '$lib/stores/setup.svelte';
	import { canVisit, permissionFor } from '$lib/permissions';
	import { permissionLabel } from '$lib/rbac';
	import { roleLabel } from '$lib/roles';
	import Panel from '$lib/components/Panel.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { children } = $props();

	// Restore the session once, before any guarded page renders.
	$effect(() => {
		void auth.restore();
	});

	// 全新部署时后端只会放行初始化接口，其余页面拿不到任何数据。这里在首屏
	// 问一次状态，把用户直接送到 /setup，而不是让每个页面各自弹一串请求失败。
	onMount(() => {
		void setup.check().then(() => setup.guard(page.url.pathname));
	});

	const path = $derived(page.url.pathname.replace(/\/+$/, ''));
	const isLogin = $derived(path === resolve('/login'));
	const isSetup = $derived(path === resolve('/setup'));

	/**
	 * 挡住「菜单里没有、但地址栏能进」的页面。
	 *
	 * 侧边栏按权限藏入口只是第一层；别人把地址发过来、或用户自己敲进去，
	 * 照样会渲染出一屏点下去就 403 的按钮。这里用与侧边栏同一张
	 * PAGE_PERMISSIONS 表做第二层拦截。
	 *
	 * auth.loading 期间一律放行：会话还没恢复完时 user 是 null、permissions
	 * 也是空的，此时若按「没权限」处理，会在 restore 成功之前先把人挡在门外
	 * ——刷新任何页面都会闪一下「没有访问权限」。
	 */
	const requiredPerm = $derived(isLogin || isSetup ? undefined : permissionFor(path));
	const allowed = $derived(auth.loading || !requiredPerm || canVisit(auth.permissions, path));
</script>

{#if isLogin || isSetup}
	{@render children()}
{:else if allowed}
	<AppShell>
		{@render children()}
	</AppShell>
{:else}
	<!--
		不给跳转而是在原地说明原因：直接把人丢回总览的话，他会以为是系统坏了，
		或者反复点侧边栏的其他入口试图「找个能进的页面」。
	-->
	<main class="mx-auto flex min-h-screen w-full max-w-[640px] flex-col justify-center px-6">
		<Panel title="没有访问权限">
			<div class="space-y-4 text-[12.5px] leading-relaxed text-fg-muted">
				<div class="flex items-start gap-2.5">
					<Icon name="alert" size={16} class="mt-px shrink-0 text-warning" />
					<p>
						当前账号（{auth.user?.display_name || auth.user?.username || '未命名账号'}
						{auth.user?.role ? `· ${roleLabel(auth.user.role)}` : ''}）不具备
						<b>{requiredPerm ? permissionLabel(requiredPerm) : ''}</b>
						这项权限（权限名：{requiredPerm ?? ''}），无法打开本页面。
					</p>
				</div>
				<p>
					侧边栏已按权限隐藏对应入口，此处再次校验用于阻止直接输入地址访问。
					如需访问该页面，请联系系统管理员开通权限。
				</p>
				<a
					href={resolve('/')}
					class="inline-flex h-9 w-fit items-center rounded-[var(--radius-form)] bg-primary px-4 text-[12.5px] font-semibold text-white no-underline transition-colors hover:bg-primary-700"
				>
					返回总览页
				</a>
			</div>
		</Panel>
	</main>
{/if}

<ToastHost />
