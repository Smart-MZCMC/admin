<script lang="ts">
	/**
	 * 版本不一致横幅。
	 *
	 * 为什么是可关闭的横幅而不是弹窗：AppShell 每 15 秒轮询一次状态，
	 * 弹窗会在用户不处理的情况下反复弹出来，反而变成噪音。横幅只在检测到
	 * 问题时出现一次，关掉后本次会话不再打扰——用户已经知道了。
	 *
	 * 两档样式：低于后端声明的最低适配版本用 error 配色（真的有功能异常），
	 * 只是落后于后端用 warning 配色（建议）。见 $lib/version 的 checkVersion。
	 */
	import { appVersion, checkVersion, type VersionStateWithFlags } from '$lib/version';
	import Button from './Button.svelte';

	interface Props {
		/** 后端 /api/status 返回的版本号；空串表示还没拿到。 */
		serverVersion: string;
		/** 后端声明的最低适配版本。老后端不返回该字段，此时留空即可。 */
		minClientVersion?: string;
	}

	let { serverVersion, minClientVersion = '' }: Props = $props();

	let dismissed = $state(false);

	const verState = $derived<VersionStateWithFlags>(
		checkVersion(appVersion, serverVersion, minClientVersion)
	);
	const visible = $derived(!dismissed && verState.shouldWarn);

	/**
	 * 提示文案。
	 *
	 * 写成普通函数而不是内联三段三元：TypeScript 的判别联合收窄在
	 * `$derived` 上不生效（每次访问 `verState` 都当成一次类型不明的取值），
	 * 内联写会直接报错。函数参数是普通局部变量，收窄正常。
	 */
	function describe(s: VersionStateWithFlags): string {
		if (s.status === 'unsupported') {
			return `管理后台版本 ${s.client} 已低于服务端要求的最低适配版本 ${s.minimum}，部分功能可能异常，请尽快更新。`;
		}
		if (s.status === 'client-behind') {
			return `管理后台版本 ${s.client} 落后于服务端 ${s.server}，建议更新后再操作。`;
		}
		if (s.status === 'client-ahead') {
			return `管理后台版本 ${s.client} 新于服务端 ${s.server}，服务端可能缺少接口，请升级服务端。`;
		}
		return '';
	}

	const text = $derived(describe(verState));

	// unsupported 用 error 配色：它意味着真的有功能异常，不是「建议」。
	const urgent = $derived(verState.isUrgent);

	// 服务端版本变化时重新提示：升级了服务端之后原来的横幅就不该继续显示。
	$effect(() => {
		void serverVersion;
		void minClientVersion;
		dismissed = false;
	});
</script>

{#if visible}
	<div
		class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 text-[12.5px] md:px-6 {urgent
			? 'border-error-ink/20 bg-error-soft text-error-ink'
			: 'border-warning-line bg-warning-soft text-warning-ink'}"
		role="status"
	>
		<svg
			class="h-4 w-4 shrink-0"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path
				d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
			/>
			<path d="M12 9v4M12 17h.01" />
		</svg>
		<span class="min-w-0 flex-1">{text}</span>
		<span class="shrink-0 font-mono text-[11px] opacity-80">本端 v{appVersion}</span>
		<Button size="sm" variant="ghost" onclick={() => (dismissed = true)}>知道了</Button>
	</div>
{/if}
