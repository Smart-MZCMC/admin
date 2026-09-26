<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api/client';
	import type { User } from '$lib/api/types';
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
	let newRole = $state<'director' | 'admin'>('director');
	let creating = $state(false);

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
			users = await api.listUsers();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '加载用户失败');
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
			feedback.error('用户名和密码不能为空');
			return;
		}
		// 与后端 minPasswordLength 保持一致，提前拦掉而不是等 400。
		if (newPassword.length < 6) {
			feedback.error('密码至少 6 位');
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
			feedback.success('用户创建成功');
			await load();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '创建用户失败');
		} finally {
			creating = false;
		}
	}

	async function changeRole(id: number, role: string) {
		try {
			await api.updateUserRole(id, role);
			feedback.success('角色已更新');
			await load();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '更新角色失败');
		}
	}

	async function confirmDelete() {
		const user = pendingDelete;
		if (!user) return;
		pendingDelete = null;
		try {
			await api.deleteUser(user.id);
			feedback.success('用户已删除');
			await load();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '删除用户失败');
		}
	}

	const adminCount = $derived(users.filter((user) => user.role === 'admin').length);
</script>

<svelte:head><title>用户管理 - 管理后台</title></svelte:head>

<PageHeader title="用户管理" description="管理员可管理全部项目，导播仅能使用被分配的项目。">
	{#snippet actions()}
		<Button variant="secondary" icon="refresh" disabled={loading} onclick={() => void load()}>
			刷新
		</Button>
		<Button variant="primary" icon="plus" onclick={openCreate}>新建用户</Button>
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
		emptyText="还没有用户，点击右上角「新建用户」开始。"
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
					text={user.role === 'admin' ? '管理员' : '导播'}
					state={user.role === 'admin' ? 'theme' : 'success'}
					size="sm"
				/>
			{:else if column.key === 'actions'}
				<div class="flex flex-wrap gap-1.5">
					{#if user.role !== 'admin'}
						<Button size="sm" variant="secondary" onclick={() => void changeRole(user.id, 'admin')}>
							设为管理员
						</Button>
					{/if}
					{#if user.role !== 'director'}
						<Button
							size="sm"
							variant="secondary"
							onclick={() => void changeRole(user.id, 'director')}
						>
							设为导播
						</Button>
					{/if}
					<Button
						size="sm"
						variant="danger-ghost"
						icon="trash"
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
	title="新建用户"
	submitText={creating ? '创建中...' : '创建'}
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
			<option value="director">导播</option>
			<option value="admin">管理员</option>
		</select>
	</label>
</Modal>

<ConfirmDialog
	visible={pendingDelete !== null}
	title="删除用户"
	message="确定删除用户「{pendingDelete?.username ??
		''}」？该用户的授权记录与控制权锁会一并清除，此操作不可撤销。"
	confirmText="删除"
	danger
	onconfirm={confirmDelete}
	onclose={() => (pendingDelete = null)}
/>
