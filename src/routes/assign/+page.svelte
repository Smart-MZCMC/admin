<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api/client';
	import type { Project, User } from '$lib/api/types';
	import { feedback } from '$lib/stores/feedback.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import Tag from '$lib/components/Tag.svelte';
	import Button from '$lib/components/Button.svelte';

	interface GrantRow {
		user_id: number;
		project_id: number;
		username: string;
		display_name: string;
		role: string;
		project_name: string;
		project_code: string;
	}

	let users = $state<User[]>([]);
	let projects = $state<Project[]>([]);
	let grants = $state<GrantRow[]>([]);
	let loading = $state(true);
	let busy = $state(false);

	let selectedUser = $state('');
	let selectedProject = $state('');

	let pendingRevoke = $state<GrantRow | null>(null);

	const columns = [
		{ key: 'username', label: '用户' },
		{ key: 'role', label: '角色', width: '8rem' },
		{ key: 'project_name', label: '项目' },
		{ key: 'project_code', label: '项目编码', width: '11rem' },
		{ key: 'actions', label: '操作', width: '7.5rem' }
	];

	async function load() {
		loading = true;
		try {
			const [userList, projectList] = await Promise.all([api.listUsers(), api.listProjects()]);
			users = userList;
			projects = projectList;

			const perUser = await Promise.all(
				userList.map(async (user) => {
					try {
						const links = await api.listUserProjects(user.id);
						return links.map((link) => ({ user, projectId: link.project_id }));
					} catch {
						return [];
					}
				})
			);

			const projectById = new Map(projectList.map((project) => [project.id, project]));
			grants = perUser.flat().map(({ user, projectId }) => {
				const project = projectById.get(projectId);
				return {
					user_id: user.id,
					project_id: projectId,
					username: user.username,
					display_name: user.display_name,
					role: user.role,
					project_name: project?.name ?? `项目 #${projectId}`,
					project_code: project?.code ?? '-'
				};
			});
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '加载授权数据失败');
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function assign() {
		if (!selectedUser || !selectedProject) {
			feedback.error('请选择用户和项目');
			return;
		}
		busy = true;
		try {
			await api.assign(Number(selectedUser), Number(selectedProject));
			feedback.success('分配成功');
			await load();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '分配失败');
		} finally {
			busy = false;
		}
	}

	async function revokeSelection() {
		if (!selectedUser || !selectedProject) {
			feedback.error('请选择用户和项目');
			return;
		}
		busy = true;
		try {
			await api.revoke(Number(selectedUser), Number(selectedProject));
			feedback.success('撤销成功');
			await load();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '撤销失败');
		} finally {
			busy = false;
		}
	}

	async function confirmRevoke() {
		const row = pendingRevoke;
		if (!row) return;
		pendingRevoke = null;
		try {
			await api.revoke(row.user_id, row.project_id);
			feedback.success('撤销成功');
			await load();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '撤销失败');
		}
	}

	// Grants for the currently picked user, to show what already exists.
	const selectedUserGrants = $derived(
		selectedUser ? grants.filter((grant) => grant.user_id === Number(selectedUser)) : []
	);

	const canSubmit = $derived(Boolean(selectedUser && selectedProject));

	const selectClass =
		'h-10 w-full rounded-[var(--radius-form)] border border-border bg-bg-surface px-3 text-[13px] text-fg transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none disabled:bg-bg-overlay disabled:text-fg-faint';
</script>

<svelte:head><title>权限分配 - 管理后台</title></svelte:head>

<PageHeader title="权限分配" description="导播只能看到被授权的项目，管理员默认拥有全部权限。">
	{#snippet actions()}
		<Button variant="secondary" icon="refresh" disabled={loading} onclick={() => void load()}>
			刷新
		</Button>
	{/snippet}
</PageHeader>

<div class="space-y-5">
	<Panel title="分配用户到项目" description="选择一名用户与一个项目，建立或解除访问授权。">
		<div class="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-medium text-fg">用户</span>
				<select bind:value={selectedUser} class={selectClass}>
					<option value="">选择用户</option>
					{#each users as user (user.id)}
						<option value={String(user.id)}>
							{user.username}{user.display_name ? ` (${user.display_name})` : ''} — {user.role ===
							'admin'
								? '管理员'
								: '导播'}
						</option>
					{/each}
				</select>
			</label>

			<label class="block">
				<span class="mb-1.5 block text-[12px] font-medium text-fg">项目</span>
				<select bind:value={selectedProject} class={selectClass}>
					<option value="">选择项目</option>
					{#each projects as project (project.id)}
						<option value={String(project.id)}>{project.name} ({project.code})</option>
					{/each}
				</select>
			</label>

			<div class="flex items-end gap-2">
				<Button variant="primary" disabled={busy || !canSubmit} onclick={() => void assign()}>
					分配
				</Button>
				<Button
					variant="danger-ghost"
					disabled={busy || !canSubmit}
					onclick={() => void revokeSelection()}
				>
					撤销所选
				</Button>
			</div>
		</div>

		{#if selectedUserGrants.length > 0}
			<div class="mt-5 border-t border-border pt-4">
				<div class="mb-2.5 text-[11.5px] font-medium text-fg-muted">该用户当前已授权项目</div>
				<div class="flex flex-wrap gap-1.5">
					{#each selectedUserGrants as grant (grant.project_id)}
						<Tag text={`${grant.project_name} (${grant.project_code})`} state="success" size="sm" />
					{/each}
				</div>
			</div>
		{:else if selectedUser}
			<div class="mt-5 border-t border-border pt-4 text-[11.5px] text-fg-faint">
				该用户尚未获得任何项目授权。
			</div>
		{/if}
	</Panel>

	<Panel title="现有授权" description="共 {grants.length} 条授权记录。" bodyClass="p-0">
		<DataTable
			{columns}
			rows={grants}
			rowKey={(row) => `${row.user_id}-${row.project_id}`}
			{loading}
			emptyText="暂无授权记录"
		>
			{#snippet cell(row, column)}
				{#if column.key === 'username'}
					<span class="font-medium text-fg">{row.username}</span>
					{#if row.display_name}
						<span class="ml-1.5 text-[11.5px] text-fg-faint">({row.display_name})</span>
					{/if}
				{:else if column.key === 'role'}
					<Tag
						text={row.role === 'admin' ? '管理员' : '导播'}
						state={row.role === 'admin' ? 'theme' : 'success'}
						size="sm"
					/>
				{:else if column.key === 'project_code'}
					<span class="font-mono text-[11.5px] text-fg-muted">{row.project_code}</span>
				{:else if column.key === 'actions'}
					<Button size="sm" variant="danger-ghost" onclick={() => (pendingRevoke = row)}
						>撤销</Button
					>
				{:else}
					{(row as unknown as Record<string, unknown>)[column.key] || '-'}
				{/if}
			{/snippet}
		</DataTable>
	</Panel>
</div>

<ConfirmDialog
	visible={pendingRevoke !== null}
	title="撤销授权"
	message="确定撤销「{pendingRevoke?.username ?? ''}」对项目「{pendingRevoke?.project_name ??
		''}」的访问权限？"
	confirmText="撤销"
	danger
	onconfirm={confirmRevoke}
	onclose={() => (pendingRevoke = null)}
/>
