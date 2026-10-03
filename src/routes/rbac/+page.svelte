<script lang="ts">
	import { onMount } from 'svelte';
	import { ApiError, api } from '$lib/api/client';
	import type { PolicyPermissionView, PolicyRoleView, PolicyView } from '$lib/api/types';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import Tag from '$lib/components/Tag.svelte';
	import {
		describeChange,
		draftFrom,
		isLockedCell,
		pendingChange,
		policyFailure,
		sortedRoles,
		submittablePermissions
	} from '$lib/rbac-matrix';
	import { feedback } from '$lib/stores/feedback.svelte';
	import { roleState } from '$lib/roles';

	/**
	 * 在线编辑 Casbin 策略矩阵。门槛 system.maintain（见 $lib/permissions），
	 * 与系统维护同档——这一页是「谁能改权限」的唯一入口，而它自己的门槛正是
	 * 那条不可撤销、且没人持有就没有任何界面能恢复的权限。
	 *
	 * 因此界面上**没有任何绕过保护的手段**：受保护的格子就是死的，没有「强制
	 * 保存」，也没有「忽略警告」。所有判定逻辑都在 $lib/rbac-matrix 里
	 * （并有 rbac-matrix.test.ts 钉住），这里只负责渲染与接线。
	 */
	let view = $state<PolicyView | null>(null);
	let loading = $state(true);
	let saving = $state(false);

	/**
	 * 正在编辑的角色，null 表示只读态。
	 *
	 * **一次只改一个角色**是有意的：后端的 PUT 语义是「把该角色的权限整体
	 * 替换成这一组」，且全有或全无。若做成「编辑全部角色一起保存」，一个请求
	 * 里混着合法项与非法项时，界面无法告诉用户是哪一项被拒——而这恰恰是最
	 * 需要说清楚的时候。
	 */
	let editingRole = $state<string | null>(null);
	/**
	 * 编辑态的草稿，只在 editingRole 非空时有意义。
	 *
	 * 与已保存值是**两个数组**（draftFrom 给的是副本）：草稿绝不写回
	 * role.grants，否则「取消一次编辑」就会在界面上毫无痕迹地改掉策略。
	 */
	let draft = $state<string[]>([]);

	/** 行按 level 从高到低；列沿用后端给的顺序（从「看」到「删系统」）。 */
	const rows = $derived(view ? sortedRoles(view.roles) : []);
	const columns = $derived(view?.permissions ?? []);

	/**
	 * 当前生效的策略不是数据库里那份。
	 *
	 * 刻意写成 `!== 'database'` 而不是 `=== 'embedded'`：后端哪天加了第三种
	 * 来源时，「不是数据库」比「是文件」更接近需要提醒的那一侧——多提醒一次
	 * 的代价只是多一条提示，而漏提醒的代价是管理员按旧策略排查很久。
	 */
	const embedded = $derived(view !== null && view.source !== 'database');
	/** 后端给的原文透传（受保护规则的理由、退回内嵌的原因、脏数据）。 */
	const notices = $derived(view?.warnings ?? []);

	const editing = $derived(rows.find((role) => role.value === editingRole) ?? null);
	/** 当前草稿相对已保存值的增删：决定「保存」能不能点，也提前把改动说一遍。 */
	const change = $derived(
		editing && view ? pendingChange(editing, view.permissions, draft) : { granted: [], revoked: [] }
	);
	const dirty = $derived(change.granted.length > 0 || change.revoked.length > 0);

	/**
	 * @param silent 静默刷新（保存后 / 失败后重新拉取）不弹加载态。
	 *   但**失败一定要出声**：静默失败会让用户以为改动生效了。
	 */
	async function load(silent = false) {
		if (!silent) loading = true;
		try {
			view = await api.policy();
		} catch (err) {
			if (silent) {
				feedback.warning('权限矩阵刷新失败，页面显示的仍是上一次读取的内容。');
			} else {
				feedback.error(err instanceof Error ? err.message : '权限矩阵读取失败。');
			}
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void load();
	});

	function startEditing(role: PolicyRoleView) {
		// 受保护的角色整行都是死的，界面上那个「编辑」按钮也是禁用的。
		// 这里再挡一次是因为这一页没有兜底：它自己的判断出错，没有任何地方
		// 能把受保护的权限改回来。
		if (role.protected) return;
		editingRole = role.value;
		draft = draftFrom(role);
	}

	function stopEditing() {
		editingRole = null;
		draft = [];
	}

	/** 这一格勾没勾：编辑态看草稿，只读态看后端给的生效值。 */
	function isChecked(role: PolicyRoleView, perm: PolicyPermissionView): boolean {
		if (editingRole === role.value) return draft.includes(perm.name);
		return role.grants.includes(perm.name);
	}

	/**
	 * 除了受保护的格子，只有**正在编辑的那一行**可点。
	 *
	 * 别人的行不是 disabled 就能点的——一次只改一个角色，而一个请求里混着
	 * 合法项与非法项时界面说不清是哪一项被拒。
	 *
	 * saving 也要算进去：请求已经发出去了，此时再点勾选只会让用户以为改动进了
	 * 这次提交（而它并没有），响应回来时整份草稿又被清掉——看上去就是「我明明
	 * 勾了，它说没改」。
	 */
	function isCellDisabled(role: PolicyRoleView, perm: PolicyPermissionView): boolean {
		return isLockedCell(role, perm) || editingRole !== role.value || saving;
	}

	function toggle(role: PolicyRoleView, perm: PolicyPermissionView) {
		if (editingRole !== role.value || isCellDisabled(role, perm)) return;
		draft = draft.includes(perm.name)
			? draft.filter((name) => name !== perm.name)
			: [...draft, perm.name];
	}

	/** 全选只作用在可改的格子上——受保护那一列压根不进草稿。 */
	function selectEditable() {
		if (!editing) return;
		draft = columns.filter((perm) => !isLockedCell(editing, perm)).map((perm) => perm.name);
	}

	function clearAll() {
		draft = [];
	}

	/**
	 * 提交该角色的**完整**权限集合。
	 *
	 * 请求体由 submittablePermissions 产出：受保护的项在数据层就被剔掉了，
	 * 一项都没勾时它给出的是空数组——那是「把这个角色的权限全部收走」，一次
	 * 合法操作，不能当成「没有改动」跳过请求。
	 */
	async function save() {
		const role = editing;
		if (!role || !view || saving || role.protected) return;
		const submitted = submittablePermissions(role, view.permissions, draft);
		saving = true;
		try {
			const result = await api.setRolePermissions(role.value, submitted);
			// 必须点名增删，不能只说「保存成功」：权限改动是要事后追责的东西，
			// 「谁多了一项能力」与「谁失去了一项能力」是两种不同的事故。
			feedback.success(`${role.label}：${describeChange(result.granted, result.revoked)}`);
			stopEditing();
			// 重新拉一次：grants / holders / source / warnings 都以刷新后的为准。
			await load(true);
			if (result.source !== 'database') {
				feedback.warning('改动已写入数据库，需等策略下次重新加载后才会生效。');
			}
		} catch (err) {
			// 按 code 分流：受保护不可改 与 「你选的东西过期了」是两回事，
			// 合成一句话的话用户会刷新一百次也刷不出来。判定在 $lib/rbac-matrix。
			const failure = policyFailure(
				err instanceof ApiError ? err.code : '',
				err instanceof Error ? err.message : '保存失败。'
			);
			feedback.error(failure.message);
			if (!failure.keepDraft) stopEditing();
			if (failure.reload) await load(true);
		} finally {
			saving = false;
		}
	}

	/** 悬停说明为什么这一格点不了。规则说给界面，理由说给人。 */
	function lockedReason(role: PolicyRoleView, perm: PolicyPermissionView): string {
		if (role.protected && perm.protected)
			return `角色「${role.label}」与权限「${perm.name}」均受保护，不可修改`;
		if (role.protected) return `角色「${role.label}」受保护，该行的权限不可修改`;
		return `权限「${perm.name}」受保护，不可修改`;
	}

	/**
	 * 编辑态下方的说明：这次到底会改什么。
	 *
	 * 保存之前就把增删点名，是为了让「保存成功」之后的那条提示不至于成为
	 * 唯一一次知情的机会——尤其是「取消了 X」这一半，它比新增更需要被看见。
	 */
	function pendingSummary(hasChanges: boolean): string {
		if (!hasChanges) return '尚无改动，可直接取消。';
		return `将 ${describeChange(change.granted, change.revoked)}。`;
	}
</script>

<svelte:head><title>角色权限 - 管理后台</title></svelte:head>

<PageHeader
	title="角色权限"
	description="本页用于设置各角色可获得的权限。改动写入策略表后立即生效，仅影响访问准入判断；角色等级仍只用于判断「能否操作他人」。"
>
	{#snippet actions()}
		{#if view}
			<Tag
				text={embedded ? '生效来源：程序内嵌文件' : '生效来源：数据库'}
				state={embedded ? 'warning' : 'success'}
			/>
		{/if}
		<Button variant="secondary" icon="refresh" disabled={loading} onclick={() => void load()}>
			刷新
		</Button>
	{/snippet}
</PageHeader>

<div class="space-y-3.5">
	<!--
		这条必须在最显眼的位置，不是一句附注。
		embedded 状态下这张矩阵上的每一格反映的都是**文件里**那一版策略：改动会
		写进数据库，但要等下次重载才生效。不说清楚的话，管理员会在「保存成功」
		之后继续按旧策略排查问题，而真相是准入判断还在用文件那一版。
	-->
	{#if embedded}
		<div
			class="flex items-start gap-2.5 rounded-[var(--radius-box)] border border-warning-line bg-warning-soft px-4 py-3"
		>
			<Icon name="alert" size={16} class="mt-px shrink-0 text-warning-ink" />
			<p class="text-[12.5px] leading-relaxed text-warning-ink">
				当前生效的是<b>随程序打包的策略文件 policy.csv</b
				>，而不是数据库中的策略。本页显示的勾选状态即文件中的版本；
				<b>在此所做的改动会写入数据库，但需等策略下次重新加载后才会生效</b
				>——在此之前，访问准入判断仍按文件中的版本执行。
			</p>
		</div>
	{/if}

	<!--
		warnings 是后端的原文透传：受保护规则为什么受保护、为什么已退回内嵌、库里
		哪几行是脏的。刻意不结构化、不改写——拆成字段总有人在界面上拼一句更短
		但信息更少的版本，而这里每一句都是判断「这一格为什么动不了」的依据。
	-->
	{#if notices.length > 0}
		<div
			class="flex items-start gap-2.5 rounded-[var(--radius-box)] border border-border bg-bg-surface px-4 py-3"
		>
			<Icon name="alert" size={16} class="mt-px shrink-0 text-fg-faint" />
			<div class="min-w-0 space-y-1">
				<p class="text-[12.5px] font-medium text-fg">服务端给出的须知</p>
				<ul class="space-y-1">
					{#each notices as notice, i (i)}
						<li class="text-[12px] leading-relaxed text-fg-muted">{notice}</li>
					{/each}
				</ul>
			</div>
		</div>
	{/if}

	{#if loading && !view}
		<Spinner label="正在读取权限矩阵…" />
	{:else if view}
		<Panel
			title="权限矩阵"
			description="行表示角色（按权限从高到低排列），列表示权限。默认为只读；点击某一行的「编辑」后才可修改，每次只能修改一个角色，保存时提交该角色的完整权限集合。"
			bodyClass="p-0"
		>
			<div class="overflow-x-auto">
				<table class="w-full border-collapse">
					<thead>
						<tr class="bg-bg-overlay/80">
							<th
								class="sticky left-0 z-10 w-[11rem] border-b border-border bg-bg-overlay px-4 py-2.5 text-left text-[10.5px] font-semibold tracking-[0.06em] whitespace-nowrap text-fg-muted uppercase"
							>
								角色
							</th>
							{#each columns as perm (perm.name)}
								<th
									class="w-[8.75rem] border-b border-l border-border px-2 py-2.5 text-left align-bottom"
									title="{perm.name} · {perm.label}"
								>
									<span class="flex items-center gap-1">
										<span class="font-mono text-[10.5px] font-semibold text-fg-muted"
											>{perm.name}</span
										>
										{#if perm.protected}
											<Tag text="受保护" state="warning" size="xs" />
										{/if}
									</span>
									<span class="mt-1 block text-[10.5px] leading-tight font-normal text-fg-faint">
										{perm.label}
									</span>
								</th>
							{/each}
							<!--
								操作列必须 sticky 到右边。矩阵有 12 列，在 1280 宽（笔记本）
								和 1920 宽（内容区被 max-w-[1400px] 限死）下表格都比可视
								区域宽 100～200px，滚不动的用户根本看不到「编辑」按钮——
								而那是这一页唯一的主操作。与左边的角色列同一套处理。
								背景必须给实色：粘住的那格不能透出底下的列。
							-->
							<th
								class="sticky right-0 z-10 w-[15rem] border-b border-l border-border bg-bg-overlay px-3 py-2.5 text-left text-[10.5px] font-semibold tracking-[0.06em] whitespace-nowrap text-fg-muted uppercase"
							>
								操作
							</th>
						</tr>
					</thead>
					<tbody>
						{#each rows as role (role.value)}
							{@const rowLocked = role.protected}
							<tr class="border-b border-border last:border-0 hover:bg-bg-overlay/60">
								<td
									class="sticky left-0 z-10 bg-bg-surface px-4 py-2.5 whitespace-nowrap {editingRole ===
									role.value
										? 'bg-bg-highlight'
										: ''}"
								>
									<span class="flex items-center gap-1.5">
										<Tag text={role.label} state={roleState(role.value)} size="sm" />
										<span class="font-mono text-[10.5px] text-fg-faint">Lv{role.level}</span>
										{#if role.protected}
											<Tag text="整行受保护" state="warning" size="xs" />
										{/if}
									</span>
								</td>
								{#each columns as perm (perm.name)}
									{@const locked = isLockedCell(role, perm)}
									{@const on = isChecked(role, perm)}
									<td
										class="border-l border-border px-2 py-2 text-center {locked
											? 'bg-bg-overlay/50'
											: ''}"
									>
										<input
											type="checkbox"
											class="h-4 w-4 accent-primary disabled:opacity-35"
											checked={on}
											disabled={isCellDisabled(role, perm)}
											title={locked ? lockedReason(role, perm) : `${perm.name} · ${perm.label}`}
											aria-label="{role.label} · {perm.name}"
											onchange={() => toggle(role, perm)}
										/>
									</td>
								{/each}
								<!--
									与表头那一格同一套：编辑中的行整条都要跟着变色，
									否则粘住的这一格会与左边那一格对不上，像两行。
								-->
								<td
									class="sticky right-0 z-10 border-l border-border bg-bg-surface px-3 py-2 {editingRole ===
									role.value
										? 'bg-bg-highlight'
										: ''}"
								>
									<!--
									按钮组必须 nowrap：这一格是 sticky 的，宽度由内容决定，
									一旦 flex-wrap 允许换行，「全选可改项 清空 保存 取消」四个
									按钮就会竖着排成四行，把正在编辑的那一行撑成别人的四倍高，
									一眼看去像是渲染坏了。保持 nowrap 时这一列会被撑到约 300px，
									表格因此更宽——而两侧都 sticky，横向滚动不影响按钮可达。
								-->
									{#if editingRole === role.value}
										<div class="flex flex-nowrap items-center gap-1.5 whitespace-nowrap">
											<Button size="sm" variant="ghost" disabled={saving} onclick={selectEditable}
												>全选可修改项</Button
											>
											<Button size="sm" variant="ghost" disabled={saving} onclick={clearAll}
												>清空</Button
											>
											<Button
												size="sm"
												variant="primary"
												loading={saving}
												disabled={!dirty}
												onclick={() => void save()}
											>
												保存
											</Button>
											<Button size="sm" variant="secondary" disabled={saving} onclick={stopEditing}
												>取消</Button
											>
										</div>
									{:else}
										<Button
											size="sm"
											variant="secondary"
											icon="edit"
											disabled={rowLocked || editingRole !== null}
											title={rowLocked
												? `角色「${role.label}」受保护，整行不可修改`
												: editingRole
													? '每次只能修改一个角色，请先保存或取消当前这一行'
													: '编辑该行的权限'}
											onclick={() => startEditing(role)}
										>
											编辑
										</Button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div class="border-t border-border bg-bg-overlay/50 px-4 py-2.5 text-[11.5px] text-fg-muted">
				{#if editing}
					正在编辑 <b class="text-fg">{editing.label}</b>：{pendingSummary(dirty)}
				{:else}
					共 {rows.length} 个角色 × {columns.length} 项权限。标记为「受保护」的格子不可修改，原因见上方须知。
				{/if}
			</div>
		</Panel>
	{:else}
		<Panel title="读取权限矩阵失败">
			<div class="space-y-3 text-[12.5px] leading-relaxed text-fg-muted">
				<p>
					未能读取权限矩阵，因此本页不显示任何内容——宁可留空，也不能依据来源不明的策略修改权限。
					常见原因是策略表无法读取（服务端会返回 policy_unavailable），稍后重试即可。
				</p>
				<Button variant="secondary" icon="refresh" onclick={() => void load()}>重试</Button>
			</div>
		</Panel>
	{/if}
</div>
