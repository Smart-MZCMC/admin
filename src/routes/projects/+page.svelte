<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api/client';
	import type { Project } from '$lib/api/types';
	import { feedback } from '$lib/stores/feedback.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import Field from '$lib/components/Field.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let projects = $state<Project[]>([]);
	let loading = $state(true);

	// create / edit form (id === null means create)
	let formOpen = $state(false);
	let editingId = $state<number | null>(null);
	let formName = $state('');
	let formCode = $state('');
	let formDescription = $state('');
	let saving = $state(false);

	let pendingDelete = $state<Project | null>(null);
	let copiedCode = $state<string | null>(null);

	const columns = [
		{ key: 'id', label: 'ID', width: '4.5rem' },
		{ key: 'name', label: '名称' },
		{ key: 'code', label: '编码', width: '12rem' },
		{ key: 'description', label: '描述' },
		{ key: 'actions', label: '操作', width: '11rem' }
	];

	async function load() {
		loading = true;
		try {
			projects = await api.listProjects();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '加载项目失败');
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function openCreate() {
		editingId = null;
		formName = '';
		formCode = '';
		formDescription = '';
		formOpen = true;
	}

	function openEdit(project: Project) {
		editingId = project.id;
		formName = project.name;
		formCode = project.code;
		formDescription = project.description ?? '';
		formOpen = true;
	}

	async function save() {
		if (saving) return;
		if (!formName.trim()) {
			feedback.error('项目名称不能为空');
			return;
		}
		if (editingId === null && !formCode.trim()) {
			feedback.error('项目编码不能为空');
			return;
		}

		saving = true;
		try {
			if (editingId === null) {
				await api.createProject({
					name: formName.trim(),
					code: formCode.trim(),
					description: formDescription.trim()
				});
				feedback.success('项目创建成功');
			} else {
				await api.updateProject(editingId, {
					name: formName.trim(),
					description: formDescription.trim()
				});
				feedback.success('项目已更新');
			}
			formOpen = false;
			await load();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '保存项目失败');
		} finally {
			saving = false;
		}
	}

	async function confirmDelete() {
		const project = pendingDelete;
		if (!project) return;
		pendingDelete = null;
		try {
			await api.deleteProject(project.id);
			feedback.success('项目已删除');
			await load();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '删除项目失败');
		}
	}

	async function copyCode(code: string) {
		try {
			await navigator.clipboard.writeText(code);
			copiedCode = code;
			setTimeout(() => (copiedCode = null), 1500);
		} catch {
			feedback.error('复制失败，请手动选择编码文本');
		}
	}

	// The backend's UpdateProject skips empty strings, so an emptied
	// description cannot be cleared once set.
	const descriptionNote = $derived(editingId !== null && !formDescription.trim());
</script>

<svelte:head><title>项目管理 - 管理后台</title></svelte:head>

<PageHeader title="项目管理" description="项目编码是各客户端订阅时使用的唯一标识，创建后不可修改。">
	{#snippet actions()}
		<Button variant="secondary" icon="refresh" disabled={loading} onclick={() => void load()}>
			刷新
		</Button>
		<Button variant="primary" icon="plus" onclick={openCreate}>新建项目</Button>
	{/snippet}
</PageHeader>

<Panel bodyClass="p-0">
	<div
		class="flex items-center justify-between gap-3 border-b border-border bg-bg-overlay/60 px-5 py-2.5"
	>
		<span class="text-[12px] text-fg-muted">共 {projects.length} 个项目</span>
	</div>

	<DataTable
		{columns}
		rows={projects}
		rowKey={(project) => project.id}
		{loading}
		emptyText="还没有项目，点击右上角「新建项目」开始。"
	>
		{#snippet cell(project, column)}
			{#if column.key === 'id'}
				<span class="font-mono text-[11.5px] text-fg-faint">#{project.id}</span>
			{:else if column.key === 'name'}
				<span class="font-medium text-fg">{project.name}</span>
			{:else if column.key === 'code'}
				<button
					type="button"
					title="点击复制编码"
					onclick={() => void copyCode(project.code)}
					class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-bg-overlay px-2 py-1 font-mono text-[11.5px] text-fg-muted transition-colors hover:border-primary/40 hover:bg-primary-soft hover:text-primary-ink"
				>
					{copiedCode === project.code ? '已复制' : project.code}
					{#if copiedCode !== project.code}
						<Icon name="copy" size={12} class="text-fg-faint" />
					{:else}
						<Icon name="check" size={12} class="text-success-ink" />
					{/if}
				</button>
			{:else if column.key === 'description'}
				<span class="text-fg-muted">{project.description || '—'}</span>
			{:else if column.key === 'actions'}
				<div class="flex flex-wrap gap-1.5">
					<Button size="sm" variant="secondary" icon="edit" onclick={() => openEdit(project)}>
						编辑
					</Button>
					<Button
						size="sm"
						variant="danger-ghost"
						icon="trash"
						onclick={() => (pendingDelete = project)}
					>
						删除
					</Button>
				</div>
			{:else}
				{(project as unknown as Record<string, unknown>)[column.key] || '-'}
			{/if}
		{/snippet}
	</DataTable>
</Panel>

<Modal
	visible={formOpen}
	title={editingId === null ? '新建项目' : '编辑项目'}
	submitText={saving ? '保存中...' : editingId === null ? '创建' : '保存'}
	submitDisabled={saving}
	onsubmit={save}
	onclose={() => (formOpen = false)}
>
	<Field label="项目名称" bind:value={formName} placeholder="如：校园运动会" required />
	{#if editingId === null}
		<Field
			label="项目编码"
			bind:value={formCode}
			placeholder="如：sports2025（唯一，创建后不可改）"
			required
		/>
	{:else}
		<div class="rounded-[var(--radius-form)] border border-border bg-bg-overlay px-3 py-2.5">
			<div class="text-[11px] text-fg-muted">项目编码（不可修改）</div>
			<div class="mt-0.5 font-mono text-[12.5px] text-fg">{formCode}</div>
		</div>
	{/if}
	<Field label="描述" bind:value={formDescription} placeholder="可选" />
	{#if descriptionNote}
		<p class="flex items-start gap-1.5 text-[11.5px] text-warning-ink">
			<Icon name="alert" size={14} class="mt-px shrink-0" />
			后端会忽略空描述，清空后无法保存，请填写其它内容或保留原值。
		</p>
	{/if}
</Modal>

<ConfirmDialog
	visible={pendingDelete !== null}
	title="删除项目"
	message="确定删除项目「{pendingDelete?.name ??
		''}」？该项目下的授权、控制权锁、采访点状态与历史消息都会被清除，此操作不可撤销。"
	confirmText="删除"
	danger
	onconfirm={confirmDelete}
	onclose={() => (pendingDelete = null)}
/>
