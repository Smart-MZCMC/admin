<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type ProjectPayload } from '$lib/api/client';
	import {
		PROJECT_MODES,
		PROJECT_MODE_LABELS,
		PROJECT_STATUSES,
		PROJECT_STATUS_LABELS,
		type Project,
		type ProjectCamera,
		type ProjectMode,
		type ProjectStatus,
		type ShotCutsResponse
	} from '$lib/api/types';
	import { feedback } from '$lib/stores/feedback.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import Field from '$lib/components/Field.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Tag from '$lib/components/Tag.svelte';

	let projects = $state<Project[]>([]);
	let loading = $state(true);

	// create / edit form (id === null means create)
	let formOpen = $state(false);
	let editingId = $state<number | null>(null);
	let formName = $state('');
	let formCode = $state('');
	let formDescription = $state('');
	let formVenue = $state('');
	let formStart = $state('');
	let formEnd = $state('');
	let formStatus = $state<ProjectStatus>('planned');
	let formMode = $state<ProjectMode>('live');
	let saving = $state(false);

	let pendingDelete = $state<Project | null>(null);
	let copiedCode = $state<string | null>(null);

	// --- 机位预设 ---
	let camerasOpen = $state(false);
	let camerasProject = $state<Project | null>(null);
	let cameras = $state<ProjectCamera[]>([]);
	let camerasLoading = $state(false);
	let newCameraName = $state('');

	// --- 切台报表 ---
	let cutsOpen = $state(false);
	let cutsProject = $state<Project | null>(null);
	let cuts = $state<ShotCutsResponse | null>(null);
	let cutsLoading = $state(false);

	const columns = [
		{ key: 'name', label: '名称' },
		{ key: 'code', label: '编码', width: '11rem' },
		{ key: 'schedule', label: '日程', width: '16rem' },
		{ key: 'status', label: '状态', width: '9rem' },
		{ key: 'description', label: '描述' },
		{ key: 'actions', label: '操作', width: '19rem' }
	];

	/**
	 * 把后端的时间转成 `<input type="datetime-local">` 认得的本地时间串。
	 *
	 * 直接把 RFC3339 丢进 input 是不行的（带了时区偏移和秒），值会被浏览器
	 * 判为非法而显示为空——用户以为日程没保存。转成本地时间再截断。
	 */
	function toLocalInput(value: string | null | undefined): string {
		if (!value) return '';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
	}

	function formatSchedule(project: Project): string {
		const start = project.scheduled_start ? new Date(project.scheduled_start) : null;
		if (!start || Number.isNaN(start.getTime())) return '未设置日程';
		const text = start.toLocaleString('zh-CN', {
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		});
		const venue = project.venue ? ` · ${project.venue}` : '';
		const mode = project.mode === 'rehearsal' ? '（彩排）' : '';
		return text + venue + mode;
	}

	function statusState(status: string | undefined) {
		switch (status) {
			case 'live':
				return 'success' as const;
			case 'finished':
				return 'neutral' as const;
			case 'cancelled':
				return 'error' as const;
			default:
				return 'info' as const;
		}
	}

	function statusLabel(status: string | undefined): string {
		if (!status) return '未设置';
		return PROJECT_STATUS_LABELS[status as ProjectStatus] ?? status;
	}

	async function load() {
		loading = true;
		try {
			projects = await api.listProjects();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '项目列表加载失败。');
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
		formVenue = '';
		formStart = '';
		formEnd = '';
		formStatus = 'planned';
		formMode = 'live';
		formOpen = true;
	}

	function openEdit(project: Project) {
		editingId = project.id;
		formName = project.name;
		formCode = project.code;
		formDescription = project.description ?? '';
		formVenue = project.venue ?? '';
		formStart = toLocalInput(project.scheduled_start);
		formEnd = toLocalInput(project.scheduled_end);
		formStatus = (project.status as ProjectStatus) || 'planned';
		formMode = (project.mode as ProjectMode) || 'live';
		formOpen = true;
	}

	async function save() {
		if (saving) return;
		if (!formName.trim()) {
			feedback.error('请填写项目名称。');
			return;
		}
		if (editingId === null && !formCode.trim()) {
			feedback.error('请填写项目编码。');
			return;
		}
		if (formStart && formEnd && formEnd < formStart) {
			feedback.error('结束时间不能早于开始时间。');
			return;
		}

		// 字段总是全部发上去。
		//
		// 后端按「键是否存在」判断要不要更新，空串表示**清空**而不是「不动」。
		// 之前后端写的是 `if description != ""`，空描述会被静默忽略，描述一旦
		// 设过就再也清不掉；界面上还专门加了一句提示来迁就它。现在可以真的清空。
		const payload: ProjectPayload = {
			name: formName.trim(),
			description: formDescription.trim(),
			venue: formVenue.trim(),
			scheduled_start: formStart,
			scheduled_end: formEnd,
			status: formStatus,
			mode: formMode
		};

		saving = true;
		try {
			if (editingId === null) {
				await api.createProject({ ...payload, code: formCode.trim() });
				feedback.success('项目已创建，机位预设已按默认列表初始化。');
			} else {
				await api.updateProject(editingId, payload);
				feedback.success('项目已更新。');
			}
			formOpen = false;
			await load();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '项目保存失败。');
		} finally {
			saving = false;
		}
	}

	/** 状态流转：只改状态这一个字段。 */
	async function changeStatus(project: Project, status: ProjectStatus) {
		try {
			await api.updateProject(project.id, { status });
			feedback.success(`已将项目「${project.name}」标记为「${PROJECT_STATUS_LABELS[status]}」。`);
			await load();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '项目状态更新失败。');
		}
	}

	async function confirmDelete() {
		const project = pendingDelete;
		if (!project) return;
		pendingDelete = null;
		try {
			await api.deleteProject(project.id);
			feedback.success('项目已删除。');
			await load();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '项目删除失败。');
		}
	}

	async function copyCode(code: string) {
		try {
			await navigator.clipboard.writeText(code);
			copiedCode = code;
			setTimeout(() => (copiedCode = null), 1500);
		} catch {
			feedback.error('复制失败，请手动选中编码文本后复制。');
		}
	}

	// --- 机位 ---
	async function openCameras(project: Project) {
		camerasProject = project;
		camerasOpen = true;
		await loadCameras(project.id);
	}

	async function loadCameras(projectId: number) {
		camerasLoading = true;
		try {
			cameras = await api.cameras(projectId);
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '机位列表加载失败。');
			cameras = [];
		} finally {
			camerasLoading = false;
		}
	}

	async function addCamera() {
		const name = newCameraName.trim();
		if (!name || !camerasProject) return;
		try {
			await api.createCamera(camerasProject.id, { name });
			newCameraName = '';
			await loadCameras(camerasProject.id);
			feedback.success('机位已添加。');
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '机位添加失败。');
		}
	}

	async function renameCamera(camera: ProjectCamera, value: string) {
		const name = value.trim();
		if (!name || name === camera.name || !camerasProject) return;
		try {
			await api.updateCamera(camerasProject.id, camera.id, { name });
			await loadCameras(camerasProject.id);
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '机位重命名失败。');
		}
	}

	async function removeCamera(camera: ProjectCamera) {
		if (!camerasProject) return;
		try {
			await api.deleteCamera(camerasProject.id, camera.id);
			await loadCameras(camerasProject.id);
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '机位删除失败。');
		}
	}

	/** 上移/下移：交换 sort_order，界面顺序即导播端按钮顺序。 */
	async function moveCamera(index: number, delta: number) {
		const target = index + delta;
		if (!camerasProject || target < 0 || target >= cameras.length) return;
		const a = cameras[index];
		const b = cameras[target];
		try {
			await api.updateCamera(camerasProject.id, a.id, { sort_order: target });
			await api.updateCamera(camerasProject.id, b.id, { sort_order: index });
			await loadCameras(camerasProject.id);
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '机位顺序调整失败。');
		}
	}

	// --- 切台报表 ---
	async function openCuts(project: Project) {
		cutsProject = project;
		cutsOpen = true;
		cutsLoading = true;
		cuts = null;
		try {
			cuts = await api.shotCuts(project.id);
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '切台记录加载失败。');
		} finally {
			cutsLoading = false;
		}
	}

	function dwell(seconds: number | undefined): string {
		if (!seconds) return '—';
		if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
		const minutes = Math.floor(seconds / 60);
		const rest = Math.round(seconds % 60);
		return `${minutes} 分 ${rest} 秒`;
	}
</script>

<svelte:head><title>项目管理 - 管理后台</title></svelte:head>

<PageHeader
	title="项目管理"
	description="项目编码是各客户端订阅时使用的唯一标识，创建后不可修改。日程决定导播端优先显示哪一场。"
>
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
		emptyText="暂无项目。可点击右上角的「新建项目」开始创建。"
	>
		{#snippet cell(project, column)}
			{#if column.key === 'id'}
				<span class="font-mono text-[11.5px] text-fg-faint">#{project.id}</span>
			{:else if column.key === 'name'}
				<span class="font-medium text-fg">{project.name}</span>
			{:else if column.key === 'code'}
				<button
					type="button"
					title="点击复制项目编码"
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
			{:else if column.key === 'schedule'}
				<span class="text-[12px] text-fg-muted">{formatSchedule(project)}</span>
			{:else if column.key === 'status'}
				<div class="flex flex-col gap-1">
					<Tag text={statusLabel(project.status)} state={statusState(project.status)} size="sm" />
					<select
						value={project.status ?? 'planned'}
						onchange={(event) =>
							void changeStatus(
								project,
								(event.currentTarget as HTMLSelectElement).value as ProjectStatus
							)}
						class="h-7 cursor-pointer rounded-md border border-border bg-bg-overlay px-1.5 text-[11px] text-fg-muted"
					>
						{#each PROJECT_STATUSES as status (status)}
							<option value={status}>{PROJECT_STATUS_LABELS[status]}</option>
						{/each}
					</select>
				</div>
			{:else if column.key === 'description'}
				<span class="text-fg-muted">{project.description || '—'}</span>
			{:else if column.key === 'actions'}
				<div class="flex flex-wrap gap-1.5">
					<Button size="sm" variant="secondary" icon="edit" onclick={() => openEdit(project)}>
						编辑
					</Button>
					<Button size="sm" variant="secondary" onclick={() => void openCameras(project)}>
						机位预设
					</Button>
					<Button size="sm" variant="secondary" onclick={() => void openCuts(project)}
						>切台记录</Button
					>
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
	submitText={saving ? '保存中…' : editingId === null ? '创建' : '保存'}
	submitDisabled={saving}
	onsubmit={save}
	onclose={() => (formOpen = false)}
>
	<Field label="项目名称" bind:value={formName} placeholder="如：校园运动会" required />
	{#if editingId === null}
		<Field
			label="项目编码"
			bind:value={formCode}
			placeholder="例如：sports2025（唯一，创建后不可修改）"
			required
		/>
	{:else}
		<div class="rounded-[var(--radius-form)] border border-border bg-bg-overlay px-3 py-2.5">
			<div class="text-[11px] text-fg-muted">项目编码（不可修改）</div>
			<div class="mt-0.5 font-mono text-[12.5px] text-fg">{formCode}</div>
		</div>
	{/if}
	<Field label="描述" bind:value={formDescription} placeholder="可选；留空会清除已有内容" />
	<Field label="场地" bind:value={formVenue} placeholder="可选，例如：田径场" />

	<div class="grid gap-3 sm:grid-cols-2">
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-medium text-fg">计划开始</span>
			<input
				type="datetime-local"
				bind:value={formStart}
				class="h-10 w-full rounded-[var(--radius-form)] border border-border bg-bg-surface px-3 text-[13px] text-fg focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none"
			/>
		</label>
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-medium text-fg">计划结束</span>
			<input
				type="datetime-local"
				bind:value={formEnd}
				class="h-10 w-full rounded-[var(--radius-form)] border border-border bg-bg-surface px-3 text-[13px] text-fg focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none"
			/>
		</label>
	</div>

	<div class="grid gap-3 sm:grid-cols-2">
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-medium text-fg">状态</span>
			<select
				bind:value={formStatus}
				class="h-10 w-full cursor-pointer rounded-[var(--radius-form)] border border-border bg-bg-surface px-3 text-[13px] text-fg"
			>
				{#each PROJECT_STATUSES as status (status)}
					<option value={status}>{PROJECT_STATUS_LABELS[status]}</option>
				{/each}
			</select>
		</label>
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-medium text-fg">模式</span>
			<select
				bind:value={formMode}
				class="h-10 w-full cursor-pointer rounded-[var(--radius-form)] border border-border bg-bg-surface px-3 text-[13px] text-fg"
			>
				{#each PROJECT_MODES as mode (mode)}
					<option value={mode}>{PROJECT_MODE_LABELS[mode]}</option>
				{/each}
			</select>
		</label>
	</div>
	<p class="text-[11.5px] text-fg-faint">彩排与正式直播的切台记录分开统计，便于赛后复盘。</p>
</Modal>

<Modal
	visible={camerasOpen}
	title={`机位预设 · ${camerasProject?.name ?? ''}`}
	submitText="关闭"
	onsubmit={() => (camerasOpen = false)}
	onclose={() => (camerasOpen = false)}
>
	<p class="text-[11.5px] text-fg-faint">
		这些名称将作为导播端预设按钮上的文字，排列顺序与此处一致。
	</p>

	<div class="flex gap-2">
		<input
			bind:value={newCameraName}
			placeholder="新机位名称，例如：终点线"
			class="h-9 flex-1 rounded-[var(--radius-form)] border border-border bg-bg-surface px-3 text-[12.5px] text-fg focus:border-primary focus:outline-none"
			onkeydown={(event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					void addCamera();
				}
			}}
		/>
		<Button
			variant="primary"
			disabled={camerasLoading || !newCameraName.trim()}
			onclick={() => void addCamera()}
		>
			添加
		</Button>
	</div>

	{#if camerasLoading}
		<p class="text-[12px] text-fg-muted">正在加载…</p>
	{:else if cameras.length === 0}
		<p class="text-[12px] text-fg-muted">
			该项目尚未设置机位预设，导播端将使用内置的 10 个默认机位。
		</p>
	{:else}
		<ul class="divide-y divide-border rounded-[var(--radius-form)] border border-border">
			{#each cameras as camera, index (camera.id)}
				<li class="flex items-center gap-2 px-3 py-2">
					<span class="w-6 shrink-0 font-mono text-[11px] text-fg-faint">{index + 1}</span>
					<input
						value={camera.name}
						onchange={(event) =>
							void renameCamera(camera, (event.currentTarget as HTMLInputElement).value)}
						class="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-[12.5px] text-fg hover:border-border focus:border-primary focus:bg-bg-surface focus:outline-none"
					/>
					<button
						type="button"
						title="上移"
						disabled={index === 0}
						onclick={() => void moveCamera(index, -1)}
						class="cursor-pointer rounded-md px-1.5 py-1 text-fg-faint hover:bg-bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
					>
						↑
					</button>
					<button
						type="button"
						title="下移"
						disabled={index === cameras.length - 1}
						onclick={() => void moveCamera(index, 1)}
						class="cursor-pointer rounded-md px-1.5 py-1 text-fg-faint hover:bg-bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
					>
						↓
					</button>
					<button
						type="button"
						title="删除"
						onclick={() => void removeCamera(camera)}
						class="cursor-pointer rounded-md px-1.5 py-1 text-fg-faint hover:bg-error-soft hover:text-error-ink"
					>
						<Icon name="trash" size={14} />
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</Modal>

<Modal
	visible={cutsOpen}
	title={`切台记录 · ${cutsProject?.name ?? ''}`}
	submitText="关闭"
	onsubmit={() => (cutsOpen = false)}
	onclose={() => (cutsOpen = false)}
>
	{#if cutsLoading}
		<p class="text-[12px] text-fg-muted">正在统计…</p>
	{:else if !cuts || cuts.total === 0}
		<p class="text-[12px] text-fg-muted">
			暂无切台记录。导播每次确认切台后都会记录一行，仅发送预告不计入记录。
		</p>
	{:else}
		<div class="grid gap-3 sm:grid-cols-3">
			<div class="rounded-[var(--radius-form)] border border-border bg-bg-overlay px-3 py-2.5">
				<div class="text-[11px] text-fg-muted">切台次数</div>
				<div class="mt-0.5 text-[18px] font-semibold text-fg">{cuts.summary.cut_count}</div>
			</div>
			<div class="rounded-[var(--radius-form)] border border-border bg-bg-overlay px-3 py-2.5">
				<div class="text-[11px] text-fg-muted">平均停留时长</div>
				<div class="mt-0.5 text-[18px] font-semibold text-fg">
					{dwell(cuts.summary.avg_dwell_seconds)}
				</div>
			</div>
			<div class="rounded-[var(--radius-form)] border border-border bg-bg-overlay px-3 py-2.5">
				<div class="text-[11px] text-fg-muted">分场</div>
				<div class="mt-1 flex flex-wrap gap-1">
					{#each cuts.summary.by_mode as item (item.mode)}
						<Tag
							text={`${item.mode === 'rehearsal' ? '彩排' : '正式直播'} ${item.cut_count}`}
							state={item.mode === 'rehearsal' ? 'info' : 'success'}
							size="xs"
						/>
					{/each}
				</div>
			</div>
		</div>

		{#if cuts.summary.by_shot.length > 0}
			<div>
				<div class="mb-1.5 text-[11.5px] font-medium text-fg-muted">按机位</div>
				<div class="flex flex-wrap gap-1.5">
					{#each cuts.summary.by_shot as item (item.shot)}
						<Tag
							text={`${item.shot} · ${item.count} 次 · 均 ${dwell(item.avg_dwell_seconds)}`}
							state="neutral"
							size="sm"
						/>
					{/each}
				</div>
			</div>
		{/if}

		<div class="max-h-64 overflow-y-auto rounded-[var(--radius-form)] border border-border">
			<table class="w-full text-left text-[12px]">
				<thead class="sticky top-0 bg-bg-overlay">
					<tr class="text-[11px] text-fg-muted">
						<th class="px-3 py-2 font-medium">时间</th>
						<th class="px-3 py-2 font-medium">原机位</th>
						<th class="px-3 py-2 font-medium">目标机位</th>
						<th class="px-3 py-2 font-medium">导播 ID</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-border">
					{#each cuts.cuts as cut (cut.id)}
						<tr>
							<td class="px-3 py-1.5 font-mono text-[11px] text-fg-muted">
								{new Date(cut.cut_at).toLocaleString('zh-CN', { hour12: false })}
							</td>
							<td class="px-3 py-1.5 text-fg-muted">{cut.from_shot || '—'}</td>
							<td class="px-3 py-1.5 font-medium text-fg">{cut.to_shot}</td>
							<td class="px-3 py-1.5 font-mono text-[11px] text-fg-faint">#{cut.director_id}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="text-[11.5px] text-fg-faint">
			共 {cuts.total} 条，最多显示 {cuts.cuts.length} 条。
		</p>
	{/if}
</Modal>

<ConfirmDialog
	visible={pendingDelete !== null}
	title="删除项目"
	message="确认删除项目「{pendingDelete?.name ??
		''}」？该项目的授权记录、控制权占用、采访点状态、机位预设、切台记录与历史消息都会被清除，且无法恢复。"
	confirmText="删除"
	danger
	onconfirm={confirmDelete}
	onclose={() => (pendingDelete = null)}
/>
