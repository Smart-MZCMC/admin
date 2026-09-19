<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api/client';
	import type { Project, User } from '$lib/api/types';
	import { feedback } from '$lib/stores/feedback.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import Tag from '$lib/components/Tag.svelte';

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
		{ key: 'actions', label: '操作', width: '7rem' }
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

	const selectClass =
		'w-full rounded-[var(--radius-form)] border border-white/10 bg-bg-base px-3 py-2.5 text-[13px] text-text-dark focus:border-primary focus:outline-none';
</script>

<svelte:head><title>权限分配 - 管理后台</title></svelte:head>

<div class="space-y-5">
	<Panel title="分配用户到项目" description="导播只能看到被授权的项目，管理员默认拥有全部权限。">
		<div class="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
			<label class="block">
				<span class="mb-1.5 block text-[12px] text-gray-500">用户</span>
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
				<span class="mb-1.5 block text-[12px] text-gray-500">项目</span>
				<select bind:value={selectedProject} class={selectClass}>
					<option value="">选择项目</option>
					{#each projects as project (project.id)}
						<option value={String(project.id)}>{project.name} ({project.code})</option>
					{/each}
				</select>
			</label>

			<div class="flex items-end gap-2">
				<button
					type="button"
					disabled={busy}
					onclick={() => void assign()}
					class="cursor-pointer rounded-[var(--radius-small)] bg-primary px-4 py-2.5 text-[12px] font-medium text-text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
				>
					分配
				</button>
				<button
					type="button"
					disabled={busy}
					onclick={() => void revokeSelection()}
					class="cursor-pointer rounded-[var(--radius-small)] border border-error/40 px-4 py-2.5 text-[12px] font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
				>
					撤销
				</button>
			</div>
		</div>

		{#if selectedUserGrants.length > 0}
			<div class="mt-4 border-t border-white/5 pt-4">
				<div class="mb-2 text-[12px] text-gray-500">该用户当前已授权项目</div>
				<div class="flex flex-wrap gap-1.5">
					{#each selectedUserGrants as grant (grant.project_id)}
						<Tag text={`${grant.project_name} (${grant.project_code})`} state="success" size="sm" />
					{/each}
				</div>
			</div>
		{/if}
	</Panel>

	<Panel title="现有授权" description="共 {grants.length} 条授权记录。">
		{#if loading}
			<Spinner />
		{:else}
			<DataTable {columns} rows={grants} rowKey={(row) => `${row.user_id}-${row.project_id}`} emptyText="暂无授权记录">
				{#snippet cell(row, column)}
					{#if column.key === 'username'}
						<span class="text-text-dark">{row.username}</span>
						{#if row.display_name}
							<span class="ml-1.5 text-gray-500">({row.display_name})</span>
						{/if}
					{:else if column.key === 'role'}
						<Tag
							text={row.role === 'admin' ? '管理员' : '导播'}
							state={row.role === 'admin' ? 'error' : 'success'}
							size="sm"
						/>
					{:else if column.key === 'project_code'}
						<span class="font-mono text-[12px]">{row.project_code}</span>
					{:else if column.key === 'actions'}
						<button
							type="button"
							onclick={() => (pendingRevoke = row)}
							class="cursor-pointer rounded-[var(--radius-small)] border border-error/40 px-2.5 py-1 text-[11px] text-error transition-colors hover:bg-error/10"
						>
							撤销
						</button>
					{:else}
						{(row as unknown as Record<string, unknown>)[column.key] || '-'}
					{/if}
				{/snippet}
			</DataTable>
		{/if}
	</Panel>
</div>

<ConfirmDialog
	visible={pendingRevoke !== null}
	title="撤销授权"
	message="确定撤销「{pendingRevoke?.username ?? ''}」对项目「{pendingRevoke?.project_name ?? ''}」的访问权限？"
	confirmText="撤销"
	danger
	onconfirm={confirmRevoke}
	onclose={() => (pendingRevoke = null)}
/>
