<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/stores/auth.svelte';
	import { feedback } from '$lib/stores/feedback.svelte';

	let username = $state('');
	let password = $state('');
	let submitting = $state(false);
	let error = $state('');

	onMount(() => {
		// Idempotent: whichever of the layout/login mounts first kicks this off.
		void auth.restore();
	});

	// Already signed in (e.g. hitting /login with a live session).
	$effect(() => {
		if (!auth.loading && auth.user) {
			void goto('/users', { replaceState: true });
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
			const user = await auth.login(username.trim(), password);
			feedback.success(`欢迎回来，${user.display_name || user.username}`);
			await goto('/users', { replaceState: true });
		} catch (err) {
			error = err instanceof Error ? err.message : '登录失败';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>登录 - 管理后台</title>
</svelte:head>

<div
	class="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_30%_20%,color-mix(in_oklch,var(--color-primary)_10%,transparent)_0%,transparent_55%)] bg-bg-base px-4"
>
	<div
		class="w-full max-w-sm rounded-2xl border border-white/10 bg-bg-surface p-8 shadow-2xl md:p-10"
	>
		<h1 class="text-center text-xl font-semibold text-primary">校园直播导播协调系统</h1>
		<p class="mt-2 mb-7 text-center text-[13px] text-gray-500">管理后台</p>

		<form
			onsubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
			class="space-y-3"
		>
			<input
				type="text"
				bind:value={username}
				placeholder="用户名"
				autocomplete="username"
				aria-label="用户名"
				class="w-full rounded-[var(--radius-form)] border border-white/10 bg-bg-base px-4 py-3 text-sm text-text-dark transition-colors placeholder:text-gray-600 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
			/>
			<input
				type="password"
				bind:value={password}
				placeholder="密码"
				autocomplete="current-password"
				aria-label="密码"
				class="w-full rounded-[var(--radius-form)] border border-white/10 bg-bg-base px-4 py-3 text-sm text-text-dark transition-colors placeholder:text-gray-600 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
			/>

			<button
				type="submit"
				disabled={submitting}
				class="mt-2 w-full cursor-pointer rounded-[var(--radius-form)] bg-primary py-3 text-[15px] font-semibold text-text-on-primary transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{submitting ? '登录中...' : '登 录'}
			</button>
		</form>

		<div class="mt-3 min-h-5 text-center text-[13px] text-error">{error}</div>
	</div>
</div>
