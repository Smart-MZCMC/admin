<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api/client';
	import type { Project } from '$lib/api/types';
	import { feedback } from '$lib/stores/feedback.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import Field from '$lib/components/Field.svelte';

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
		{ key: 'id', label: 'ID', width: '5rem' },
		{ key: 'name', label: '名称' },
		{ key: 'code', label: '编码', width: '12rem' },
		{ key: 'description', label: '描述' },
		{ key: 'actions', label: '操作', width: '12rem' }
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

<Panel
	title="项目列表"
	description="共 {projects.length} 个项目。项目编码是各客户端订阅时使用的唯一标识，创建后不可修改。"
>
	{#snippet actions()}
		<button
			type="button"
			onclick={openCreate}
			class="cursor-pointer rounded-[var(--radius-small)] bg-primary px-3.5 py-2 text-[12px] font-medium text-text-on-primary transition-opacity hover:opacity-90"
		>
			+ 新建项目
		</button>
	{/snippet}

	<DataTable {columns} rows={projects} rowKey={(project) => project.id} {loading} emptyText="暂无项目">
		{#snippet cell(project, column)}
			{#if column.key === 'code'}
				<button
					type="button"
					title="点击复制编码"
					onclick={() => void copyCode(project.code)}
					class="cursor-pointer rounded-[var(--radius-small)] bg-bg-base px-2 py-1 font-mono text-[12px] text-gray-300 transition-colors hover:text-primary"
				>
					{copiedCode === project.code ? '已复制 ✓' : project.code}
				</button>
			{:else if column.key === 'actions'}
				<div class="flex flex-wrap gap-1.5">
					<button
						type="button"
						onclick={() => openEdit(project)}
						class="cursor-pointer rounded-[var(--radius-small)] border border-white/10 px-2.5 py-1 text-[11px] text-gray-400 transition-colors hover:border-primary hover:text-primary"
					>
						编辑
					</button>
					<button
						type="button"
						onclick={() => (pendingDelete = project)}
						class="cursor-pointer rounded-[var(--radius-small)] border border-error/40 px-2.5 py-1 text-[11px] text-error transition-colors hover:bg-error/10"
					>
						删除
					</button>
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
		<Field label="项目编码" bind:value={formCode} placeholder="如：sports2025（唯一，创建后不可改）" required />
	{:else}
		<div class="rounded-[var(--radius-form)] border border-white/10 bg-bg-base px-3 py-2.5">
			<div class="text-[11px] text-gray-500">项目编码（不可修改）</div>
			<div class="mt-0.5 font-mono text-[13px] text-gray-300">{formCode}</div>
		</div>
	{/if}
	<Field label="描述" bind:value={formDescription} placeholder="可选" />
	{#if descriptionNote}
		<p class="text-[11px] text-warning">后端会忽略空描述，清空后无法保存，请填写其它内容或保留原值。</p>
	{/if}
</Modal>

<ConfirmDialog
	visible={pendingDelete !== null}
	title="删除项目"
	message="确定删除项目「{pendingDelete?.name ?? ''}」？该项目下的授权、控制权锁、采访点状态与历史消息都会被清除，此操作不可撤销。"
	confirmText="删除"
	danger
	onconfirm={confirmDelete}
	onclose={() => (pendingDelete = null)}
/>
