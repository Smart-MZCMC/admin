<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api/client';
	import type { Message, Project } from '$lib/api/types';
	import { feedback } from '$lib/stores/feedback.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import Tag from '$lib/components/Tag.svelte';

	const MESSAGE_TYPES = ['next_shot', 'chat', 'interview_status', 'lock_update', 'system'];

	let messages = $state<Message[]>([]);
	let projects = $state<Project[]>([]);
	let loading = $state(true);
	let exporting = $state(false);

	let filterProject = $state('');
	let filterType = $state('');
	let limit = $state('100');

	let cleanupOpen = $state(false);
	let cleanupDays = $state('30');
	let cleaning = $state(false);

	const columns = [
		{ key: 'id', label: 'ID', width: '5rem' },
		{ key: 'created_at', label: '时间', width: '12rem' },
		{ key: 'project_id', label: '项目', width: '10rem' },
		{ key: 'sender_id', label: '发送者', width: '6rem' },
		{ key: 'type', label: '类型', width: '10rem' },
		{ key: 'content', label: '内容' }
	];

	const projectById = $derived(new Map(projects.map((project) => [project.id, project])));

	function projectLabel(projectId: number): string {
		const project = projectById.get(projectId);
		return project ? `${project.name}` : `#${projectId}`;
	}

	async function load() {
		loading = true;
		try {
			const result = await api.listLogs({
				projectId: filterProject || undefined,
				type: filterType || undefined,
				limit: Number(limit)
			});
			messages = result.messages ?? [];
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '加载日志失败');
			messages = [];
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		try {
			projects = await api.listProjects();
		} catch {
			// Non-fatal: the log table falls back to raw project ids.
		}
		await load();
	});

	function formatTime(value: string): string {
		if (!value) return '-';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;
		return date.toLocaleString('zh-CN', { hour12: false });
	}

	const typeState: Record<string, 'theme' | 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
		next_shot: 'theme',
		chat: 'info',
		interview_status: 'success',
		lock_update: 'warning',
		system: 'neutral'
	};

	function csvEscape(value: unknown): string {
		const text = value === null || value === undefined ? '' : String(value);
		return `"${text.replace(/"/g, '""')}"`;
	}

	function download(filename: string, text: string, mime: string) {
		const blob = new Blob([text], { type: mime });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = filename;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	function stamp(): string {
		return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	}

	/**
	 * POST /api/logs/export returns the full project history (up to 1000 rows)
	 * as JSON. A project must be selected because the handler rejects id 0.
	 */
	async function exportJson() {
		if (!filterProject) {
			feedback.error('请先选择要导出的项目');
			return;
		}
		exporting = true;
		try {
			const result = await api.exportLogs(Number(filterProject));
			download(
				`logs-project${filterProject}-${stamp()}.json`,
				JSON.stringify(result, null, 2),
				'application/json'
			);
			feedback.success(`已导出 ${result.count} 条日志`);
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '导出失败');
		} finally {
			exporting = false;
		}
	}

	/**
	 * NOTE: the backend registers /api/logs/export and /api/logs/export/csv in
	 * no route file — see backend/routes/web.go. CSV is therefore generated
	 * client-side from the rows already fetched, which also respects filters.
	 */
	function exportCsv() {
		if (messages.length === 0) {
			feedback.error('当前没有可导出的日志');
			return;
		}
		const header = ['id', 'created_at', 'project_id', 'project_name', 'sender_id', 'type', 'content'];
		const lines = [header.join(',')];
		for (const message of messages) {
			lines.push(
				[
					message.id,
					message.created_at,
					message.project_id,
					projectLabel(message.project_id),
					message.sender_id,
					message.type,
					message.content
				]
					.map(csvEscape)
					.join(',')
			);
		}
		download(`logs-${stamp()}.csv`, '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8');
		feedback.success(`已导出 ${messages.length} 条日志`);
	}

	async function runCleanup() {
		cleaning = true;
		try {
			const days = Number(cleanupDays) || 30;
			const result = await api.cleanupLogs(days);
			cleanupOpen = false;
			feedback.success(result.message || `已清理 ${result.count} 条日志`);
			await load();
		} catch (err) {
			feedback.error(err instanceof Error ? err.message : '清理失败');
		} finally {
			cleaning = false;
		}
	}

	const inputClass =
		'w-full rounded-[var(--radius-form)] border border-white/10 bg-bg-base px-3 py-2 text-[13px] text-text-dark focus:border-primary focus:outline-none';
</script>

<svelte:head><title>历史日志 - 管理后台</title></svelte:head>

<div class="space-y-5">
	<Panel title="日志筛选" description="按项目与消息类型过滤，默认返回最近 100 条。">
		<div class="grid gap-4 md:grid-cols-4">
			<label class="block">
				<span class="mb-1.5 block text-[12px] text-gray-500">项目</span>
				<select bind:value={filterProject} class={inputClass}>
					<option value="">全部项目</option>
					{#each projects as project (project.id)}
						<option value={String(project.id)}>{project.name} ({project.code})</option>
					{/each}
				</select>
			</label>

			<label class="block">
				<span class="mb-1.5 block text-[12px] text-gray-500">消息类型</span>
				<select bind:value={filterType} class={inputClass}>
					<option value="">全部类型</option>
					{#each MESSAGE_TYPES as type (type)}
						<option value={type}>{type}</option>
					{/each}
				</select>
			</label>

			<label class="block">
				<span class="mb-1.5 block text-[12px] text-gray-500">返回条数</span>
				<select bind:value={limit} class={inputClass}>
					<option value="100">100</option>
					<option value="200">200</option>
					<option value="500">500</option>
				</select>
			</label>

			<div class="flex items-end">
				<button
					type="button"
					onclick={() => void load()}
					disabled={loading}
					class="w-full cursor-pointer rounded-[var(--radius-small)] bg-primary px-4 py-2 text-[12px] font-medium text-text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
				>
					{loading ? '查询中...' : '查询'}
				</button>
			</div>
		</div>

		<div class="mt-4 flex flex-wrap gap-2 border-t border-white/5 pt-4">
			<button
				type="button"
				disabled={exporting}
				onclick={() => void exportJson()}
				class="cursor-pointer rounded-[var(--radius-small)] border border-white/10 px-3.5 py-2 text-[12px] text-gray-400 transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
			>
				{exporting ? '导出中...' : '导出 JSON'}
			</button>
			<button
				type="button"
				onclick={exportCsv}
				class="cursor-pointer rounded-[var(--radius-small)] border border-white/10 px-3.5 py-2 text-[12px] text-gray-400 transition-colors hover:border-primary hover:text-primary"
			>
				导出 CSV（当前结果）
			</button>
			<button
				type="button"
				onclick={() => (cleanupOpen = true)}
				class="cursor-pointer rounded-[var(--radius-small)] border border-error/40 px-3.5 py-2 text-[12px] text-error transition-colors hover:bg-error/10"
			>
				清理过期日志
			</button>
		</div>
	</Panel>

	<Panel title="日志记录" description="按时间倒序排列，最多显示 {Number(limit)} 条。">
		{#if loading}
			<Spinner />
		{:else}
			<DataTable {columns} rows={messages} rowKey={(message) => message.id} emptyText="暂无日志记录">
				{#snippet cell(message, column)}
					{#if column.key === 'created_at'}
						<span class="font-mono text-[12px] whitespace-nowrap">{formatTime(message.created_at)}</span>
					{:else if column.key === 'project_id'}
						{projectLabel(message.project_id)}
						<span class="ml-1 text-gray-600">#{message.project_id}</span>
					{:else if column.key === 'type'}
						<Tag
							text={message.type}
							state={typeState[message.type] ?? 'neutral'}
							size="sm"
						/>
					{:else if column.key === 'content'}
						<span class="block max-w-xl break-words">{message.content || '-'}</span>
					{:else}
						{(message as unknown as Record<string, unknown>)[column.key] || '-'}
					{/if}
				{/snippet}

				{#snippet footer()}
					共 {messages.length} 条
				{/snippet}
			</DataTable>
		{/if}
	</Panel>
</div>

<ConfirmDialog
	visible={cleanupOpen}
	title="清理过期日志"
	message="将删除早于指定天数的全部消息记录。此操作不可撤销。"
	confirmText={cleaning ? '清理中...' : '确认清理'}
	danger
	onconfirm={runCleanup}
	onclose={() => (cleanupOpen = false)}
>
	<label class="block">
		<span class="mb-1.5 block text-[12px] text-gray-500">保留最近天数</span>
		<input
			type="number"
			min="1"
			bind:value={cleanupDays}
			class="w-full rounded-[var(--radius-form)] border border-white/10 bg-bg-base px-3 py-2 text-[13px] text-text-dark focus:border-primary focus:outline-none"
		/>
	</label>
</ConfirmDialog>
