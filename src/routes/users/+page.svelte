<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api/client';
	import type { Role, RoleInfo, User } from '$lib/api/types';
	import {
		deleteBlockedReason,
		roleAtLeast,
		roleLabel,
		roleState,
		switchableRoles as switchableRolesFor
	} from '$lib/roles';
	import { auth } from '$lib/stores/auth.svelte';
	import { feedback } from '$lib/stores/feedback.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import Field from '$lib/components/Field.svelte';
	import Tag from '$lib/components/Tag.svelte';
	import Button from '$lib/components/Button.svelte';

	let users = $state<User[]>([]);
	let loading = $state(true);

	// create-user form
	let createOpen = $state(false);
	let newUsername = $state('');
	let newPassword = $state('');
	let newDisplayName = $state('');
	let newRole = $state<Role>('director');
	let creating = $state(false);

	// 角色清单由后端提供。硬编码一份下拉选项的问题是：后端加了角色这里不会
	// 跟着变，而且会出现「能选但提交被拒」或「后端允许却选不出来」。
	let allRoles = $state<RoleInfo[]>([]);

	/**
	 * 只能授予不高于自己的角色——与后端 guardGrant 同一套规则。
	 *
	 * 这一条刻意仍按**角色等级**判断：它属于控制器层的「能否操作他人」，
	 * 与 user.manage 那个准入层是叠加关系，不是替代关系。
	 */
	const grantableRoles = $derived(allRoles.filter((r) => auth.atLeast(r.value)));

	/**
	 * 准入层：能不能进改角色/删账号/新建用户这些接口。
	 *
	 * auth.actor 每次访问返回新对象，所以要派生一份再用——直接放进 $derived
	 * 会因引用每次都变而永远重算（功能上没错，但白白丢掉依赖追踪）。
	 *
	 * 页面本身只要求 user.view（负责人就能进来看人），增删改另需 user.manage，
	 * 于是这个页面上确实存在「看得见表格、但操作按钮全禁用」的负责人。
	 */
	const actor = $derived.by(() => auth.actor);

	/**
	 * 某个用户可以被改成哪些角色（判定逻辑在 $lib/roles 里，好单测）。
	 *
	 * 这里只负责把后端下发的角色清单接上去。
	 */
	function switchableRoles(target: User): RoleInfo[] {
		const allowed = switchableRolesFor(
			actor,
			target,
			allRoles.map((r) => r.value)
		);
		return allRoles.filter((r) => allowed.includes(r.value));
	}

	// delete confirmation
	let pendingDelete = $state<User | null>(null);

	const columns = [
		{ key: 'id', label: 'ID', width: '4.5rem' },
		{ key: 'username', label: '用户名' },
		{ key: 'display_name', label: '显示名' },
		{ key: 'role', label: '角色', width: '8rem' },
		{ key: 'actions', label: '操作', width: '20rem' }
	];

	async function load() {
		loading = true;
		try {
			// 角色清单只在下拉框里用，接口失败不该让整个页面不可用。
			api
				.roles()
				.then((r) => (allRoles = r))
				.catch(() => (allRoles = []));
			users = await api.listUsers();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '账号列表加载失败。');
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function openCreate() {
		newUsername = '';
		newPassword = '';
		newDisplayName = '';
		newRole = 'director';
		createOpen = true;
	}

	async function createUser() {
		if (creating) return;
		if (!newUsername.trim() || !newPassword) {
			feedback.error('请填写用户名和密码。');
			return;
		}
		// 与后端 minPasswordLength 保持一致，提前拦掉而不是等 400。
		if (newPassword.length < 6) {
			feedback.error('密码至少 6 位。');
			return;
		}
		creating = true;
		try {
			await api.register({
				username: newUsername.trim(),
				password: newPassword,
				display_name: newDisplayName.trim(),
				role: newRole
			});
			createOpen = false;
			feedback.success('账号已创建。');
			await load();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '账号创建失败。');
		} finally {
			creating = false;
		}
	}

	async function changeRole(id: number, role: string) {
		try {
			await api.updateUserRole(id, role);
			feedback.success('角色已更新。');
			await load();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '角色更新失败。');
		}
	}

	async function confirmDelete() {
		const user = pendingDelete;
		if (!user) return;
		pendingDelete = null;
		try {
			await api.deleteUser(user.id);
			feedback.success('账号已删除。');
			await load();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '账号删除失败。');
		}
	}

	// 达到管理员等级的都算（含超管）。原来只数 role === 'admin'，
	// 超管会被漏掉，页面上显示的「管理员 N 个」会少一人。
	const adminCount = $derived(users.filter((u) => roleAtLeast(u.role, 'admin')).length);

	/**
	 * 系统里现有的超管数量。
	 *
	 * 「能不能删某个超管」取决于删完还剩不剩超管，所以这个判断必须带上全量计数——
	 * 只看目标那一个是不够的。用户列表本来就在手上，数一下即可。
	 */
	const superAdminCount = $derived(users.filter((u) => u.role === 'super_admin').length);
</script>

<svelte:head><title>用户管理 - 管理后台</title></svelte:head>

<PageHeader
	title="用户管理"
	description="管理员可管理全部项目，导播仅能使用被授权的项目。新建与删除账号、调整角色需要账号管理权限。"
>
	{#snippet actions()}
		<Button variant="secondary" icon="refresh" disabled={loading} onclick={() => void load()}>
			刷新
		</Button>
		<!--
			新建用户要 user.manage，与改角色、删账号是同一道门。负责人能进这个
			页面（user.view）却建不了人，不藏按钮的话点了必然失败。
		-->
		{#if auth.can('user.manage')}
			<Button variant="primary" icon="plus" onclick={openCreate}>新建账号</Button>
		{/if}
	{/snippet}
</PageHeader>

<Panel bodyClass="p-0">
	<div
		class="flex items-center justify-between gap-3 border-b border-border bg-bg-overlay/60 px-5 py-2.5"
	>
		<span class="text-[12px] text-fg-muted">共 {users.length} 个账号</span>
		<span class="text-[11.5px] text-fg-faint">{adminCount} 位管理员</span>
	</div>

	<DataTable
		{columns}
		rows={users}
		rowKey={(user) => user.id}
		{loading}
		emptyText="暂无账号。可点击右上角的「新建账号」开始创建。"
	>
		{#snippet cell(user, column)}
			{#if column.key === 'id'}
				<span class="font-mono text-[11.5px] text-fg-faint">#{user.id}</span>
			{:else if column.key === 'username'}
				<span class="font-medium text-fg">{user.username}</span>
			{:else if column.key === 'display_name'}
				{user.display_name || '—'}
			{:else if column.key === 'role'}
				<Tag
					text={user.role_label ?? roleLabel(user.role)}
					state={roleState(user.role)}
					size="sm"
				/>
			{:else if column.key === 'actions'}
				<div class="flex flex-wrap items-center gap-1.5">
					<!--
						角色改动做成下拉而不是几个写死按钮：角色已经有八个，
						写「设为管理员 / 设为导播」两个按钮既覆盖不了，其余六个
						还漏在界面上。而且下拉能天然按「我能授予什么」过滤。
					-->
					{#if switchableRoles(user).length > 0}
						<select
							class="h-8 rounded-[var(--radius-form)] border border-border bg-bg-surface px-2 text-[12px] text-fg transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none"
							value=""
							onchange={(e) => {
								const v = e.currentTarget.value;
								if (v) void changeRole(user.id, v as Role);
								e.currentTarget.value = '';
							}}
						>
							<option value="" disabled>改为…</option>
							{#each switchableRoles(user) as r (r.value)}
								<option value={r.value}>{r.label}</option>
							{/each}
						</select>
					{/if}
					<!--
						删除按钮按「真删得掉」显示，而不是一律摆出来。
						此前它没有任何门控，于是系统里唯一的超管在自己那一行也看得到
						「删除」——后端会返回「不能删除自己的账号」，但界面上那个
						可点的红按钮看上去就像「超管可以被删掉」。
						不可删时用禁用按钮加 title 说明原因，而不是直接消失：
						直接消失会让人以为漏加载了，禁用加说明才讲得清规矩。
					-->
					<Button
						size="sm"
						variant="danger-ghost"
						icon="trash"
						disabled={deleteBlockedReason(actor, user, superAdminCount) !== ''}
						title={deleteBlockedReason(actor, user, superAdminCount) || '删除该账号'}
						onclick={() => (pendingDelete = user)}
					>
						删除
					</Button>
				</div>
			{:else}
				{(user as unknown as Record<string, unknown>)[column.key] || '-'}
			{/if}
		{/snippet}
	</DataTable>
</Panel>

<Modal
	visible={createOpen}
	title="新建账号"
	submitText={creating ? '创建中…' : '创建'}
	submitDisabled={creating}
	onsubmit={createUser}
	onclose={() => (createOpen = false)}
>
	<Field label="用户名" bind:value={newUsername} placeholder="请输入用户名" required />
	<Field label="密码" bind:value={newPassword} type="password" placeholder="至少 6 位" required />
	<Field label="显示名" bind:value={newDisplayName} placeholder="可选" />
	<label class="block">
		<span class="mb-1.5 block text-[12px] font-medium text-fg">角色</span>
		<select
			bind:value={newRole}
			class="h-10 w-full rounded-[var(--radius-form)] border border-border bg-bg-surface px-3 text-[13px] text-fg transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none"
		>
			{#each grantableRoles as r (r.value)}
				<option value={r.value}>{r.label}</option>
			{/each}
		</select>
		<p class="mt-1.5 text-[11.5px] text-fg-faint">
			只能授予等级不高于当前账号的角色。如需更高权限，请联系超级管理员。
		</p>
	</label>
</Modal>

<ConfirmDialog
	visible={pendingDelete !== null}
	title="删除账号"
	message="确认删除账号「{pendingDelete?.username ??
		''}」？该账号的授权记录与控制权占用会一并清除，且无法恢复。"
	confirmText="删除"
	danger
	onconfirm={confirmDelete}
	onclose={() => (pendingDelete = null)}
/>
