<script lang="ts">
	/**
	 * 个人中心：改显示名 / 邮箱 / 密码。
	 *
	 * 邮箱同时是 WeAvatar 头像的取值来源。这里必须把话说清楚：**头像不是在
	 * 本系统里上传的**。用户要先去 weavatar.com 注册、绑定这个邮箱并完成验证，
	 * 这里才能取到；没有注册过的邮箱会拿到 WeAvatar 返回的字母头像。
	 *
	 * 改密码会让所有旧令牌立即失效（后端递增 token_version）。所以提交成功后
	 * 必须用后端返回的新令牌覆盖本地那份，否则当前设备会被自己踢到登录页。
	 */
	import { auth } from '$lib/stores/auth.svelte';
	import { feedback } from '$lib/stores/feedback.svelte';
	import Button from '$lib/components/Button.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import Field from '$lib/components/Field.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import Tag from '$lib/components/Tag.svelte';

	// ---- 个人资料 ----
	let displayName = $state('');
	let email = $state('');
	let savingProfile = $state(false);

	// ---- 修改密码 ----
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let savingPassword = $state(false);
	let confirmOpen = $state(false);

	/** 头像没加载出来时（内网无外网、或用户未在 WeAvatar 注册）回退到首字母。 */
	let avatarFailed = $state(false);

	const user = $derived(auth.user);
	const initials = $derived(
		(user?.display_name || user?.username || '?').slice(0, 1).toUpperCase()
	);
	const avatarUrl = $derived(avatarFailed ? '' : (user?.avatar_url ?? ''));

	// 首屏把表单填上现有值。
	$effect(() => {
		if (user) {
			displayName = user.display_name ?? '';
			email = user.email ?? '';
		}
	});

	/** 本地先拦一道，省得发出去等一个 400 回来。 */
	function validateProfile(): string {
		if (displayName.trim().length > 100) return '显示名不能超过 100 个字符';
		const trimmed = email.trim();
		if (trimmed !== '' && !/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(trimmed)) {
			return '邮箱格式不正确';
		}
		return '';
	}

	async function saveProfile() {
		const problem = validateProfile();
		if (problem) {
			feedback.error(problem);
			return;
		}
		savingProfile = true;
		try {
			await auth.updateProfile({
				display_name: displayName.trim(),
				// 传空串表示清空邮箱，这是允许的（邮箱用于头像，不是登录名）。
				email: email.trim()
			});
			// 邮箱变了就该重新取头像，否则会一直显示旧的那张。
			avatarFailed = false;
			feedback.success('个人资料已保存。');
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '保存失败。');
		} finally {
			savingProfile = false;
		}
	}

	function validatePassword(): string {
		if (!currentPassword) return '请输入当前密码';
		if (newPassword.length < 6) return '新密码至少 6 位';
		if (newPassword !== confirmPassword) return '两次输入的新密码不一致';
		return '';
	}

	/** 第一步只做本地校验，通过后弹确认框，说明改完会发生什么。 */
	function requestPasswordChange() {
		const problem = validatePassword();
		if (problem) {
			feedback.error(problem);
			return;
		}
		confirmOpen = true;
	}

	async function doChangePassword() {
		savingPassword = true;
		try {
			await auth.changePassword(currentPassword, newPassword);
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
			confirmOpen = false;
			feedback.success('密码已修改，其他设备的登录状态已失效。');
		} catch (err) {
			// 当前密码错误时后端返回 400 而不是 401 —— 401 会把用户踢回登录页。
			feedback.error(err instanceof Error ? err.message : '密码修改失败。');
		} finally {
			savingPassword = false;
		}
	}
</script>

<svelte:head><title>个人中心 - 管理后台</title></svelte:head>

<PageHeader title="个人中心" description="维护当前账号的显示资料、邮箱与登录密码。" />

<div class="flex flex-col gap-5">
	<Panel title="资料">
		<div class="flex items-center gap-4">
			<Avatar url={avatarUrl} name={initials} size={56} class="text-[18px]" />
			<div class="min-w-0">
				<div class="truncate text-[14px] font-medium text-fg">
					{user?.display_name || user?.username}
				</div>
				<div class="mt-1 flex flex-wrap items-center gap-2">
					<span class="text-[12px] text-fg-faint">@{user?.username}</span>
					<Tag text={user?.role_label ?? ''} state="neutral" size="sm" />
				</div>
			</div>
		</div>

		<div class="mt-5 grid max-w-md gap-4">
			<Field
				label="用户名"
				value={user?.username ?? ''}
				disabled
				hint="用户名用于登录，创建后不可修改。"
			/>
			<Field label="显示名" bind:value={displayName} placeholder="可选" />
			<Field
				label="邮箱"
				type="email"
				bind:value={email}
				autocomplete
				placeholder="可选"
				hint="邮箱仅用于匹配 WeAvatar 头像，不用于登录，也不会收到任何邮件。"
			/>
			<div>
				<Button disabled={savingProfile} onclick={() => void saveProfile()}>
					{savingProfile ? '保存中…' : '保存资料'}
				</Button>
			</div>
		</div>
	</Panel>

	<Panel title="修改密码">
		<div class="grid max-w-md gap-4">
			<p class="text-[12.5px] leading-relaxed text-fg-muted">
				修改后，<span class="font-medium text-fg">当前账号在其他所有设备上的登录状态将立即失效</span
				>，需使用新密码重新登录。当前设备的登录状态会自动延续，不会被强制退出。
			</p>
			<Field label="当前密码" type="password" bind:value={currentPassword} autocomplete />
			<Field label="新密码" type="password" bind:value={newPassword} hint="至少 6 位" />
			<Field
				label="确认新密码"
				type="password"
				bind:value={confirmPassword}
				onenter={requestPasswordChange}
			/>
			<div>
				<Button variant="danger" disabled={savingPassword} onclick={requestPasswordChange}>
					{savingPassword ? '提交中…' : '修改密码'}
				</Button>
			</div>
		</div>
	</Panel>

	<Panel title="关于头像">
		<p class="text-[12.5px] leading-relaxed text-fg-muted">
			头像来自
			<a
				class="text-primary hover:underline"
				href="https://weavatar.com"
				target="_blank"
				rel="noreferrer">WeAvatar</a
			>，按邮箱匹配。若需显示真实头像，请先在 WeAvatar
			官网注册，绑定上方填写的邮箱并完成验证；未注册的邮箱将显示为首字母圆形头像。本平台不提供头像上传功能，也不托管头像文件。
		</p>
		<p class="mt-2 text-[12px] text-fg-faint">
			内网无法访问外网时，头像可能无法加载，此时会自动回退为首字母圆形头像，不影响使用。
		</p>
	</Panel>
</div>

<ConfirmDialog
	visible={confirmOpen}
	title="修改密码"
	message="确认修改密码？其他设备上的登录状态将立即失效。"
	confirmText={savingPassword ? '提交中…' : '确认修改'}
	danger
	onconfirm={() => void doChangePassword()}
	onclose={() => (confirmOpen = false)}
/>
