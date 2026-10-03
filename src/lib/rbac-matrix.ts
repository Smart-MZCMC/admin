/**
 * 权限矩阵（角色 × 权限）的纯逻辑：哪些格子不可点、提交给后端的那一组勾选是
 * 什么、以及后端的错误类别该怎么处置。
 *
 * 为什么要整段抽出来（而不是留在 /rbac 页面里）：**这个界面的门槛是
 * system.maintain**——一条不可撤销、且一旦没人持有就没有任何界面能把它恢复
 * 的权限。也就是说它是「谁能改权限」的唯一入口，它自己那几道判断出错时
 * 没有任何兜底可指望。于是三件最该被测试覆盖的事全都不该待在组件里：
 *  1. 受保护的格子不可能进提交集合（点不到之外，还要在数据层再挡一次）；
 *  2. 编辑态的草稿不会写回已保存值（否则「取消」等于悄悄改了策略）；
 *  3. 一项都没勾时提交的是**空数组**（清空权限是合法操作），而不是「不提交」。
 * 组件里的局部函数没法单测，理由与 $lib/version、$lib/roles 相同。
 *
 * ⚠️ 这里**不**重新判断「哪些是受保护的」。那份语义由后端在响应里下发
 *    （permission.protected / role.protected），前端只负责把它画成不可点，
 *    并保证这样的格子永远进不了 PUT 的请求体。两边各写一份「受保护清单」，
 *    迟早分叉，而分叉之后生效的是前端那份没人 review 的。
 */
import type { PolicyPermissionView, PolicyRoleView } from './api/types';
import { permissionLabel } from './rbac';

/**
 * 矩阵里的某一格是否不可改。
 *
 * 两种来源，后端 protect.go 里是两条独立的守卫：
 *  - 角色受保护（超级管理员）：它的整行都不能改，动它等于把「系统维护权限
 *    只属于最高角色」那条规则的受益者拿掉。
 *  - 权限受保护（目前只有 system.maintain）：它的整列都不能改——不可撤销，
 *    哪怕是从持有者自己身上取消。
 *
 * 注意这里是**或**，不是与：一格只要沾上任意一边就是死的。反过来写成「两者
 * 都受保护才死」的话，界面就会放出大量点了必定 403 的格子。
 */
export function isLockedCell(role: PolicyRoleView, perm: PolicyPermissionView): boolean {
	return role.protected || perm.protected;
}

/**
 * 行顺序：等级从高到低。
 *
 * 返回新数组，不改调用点传进来的那个（$derived 每次都重算，原地排序会在
 * 同一份数据上反复排，虽说不坏但依赖追踪会变得难以推理）。
 * 同等级的（解说与前期同为 20）保持后端给的顺序——Array.sort 是稳定排序。
 */
export function sortedRoles(roles: readonly PolicyRoleView[]): PolicyRoleView[] {
	return [...roles].sort((a, b) => b.level - a.level);
}

/**
 * 进入编辑态时的草稿初值。
 *
 * 必须是**副本**。直接给 `role.grants` 会让草稿与已保存值是同一个数组：取消
 * 一个勾选就等于在内存里悄悄改了已保存的策略，而界面还显示着保存前的样子；
 * 用户点「取消」也回不去了。这正是这一页唯一能造成「我什么都没干，权限却变了」
 * 的那种 bug，所以单独抽成一个函数并由 rbac-matrix.test.ts 钉住。
 */
export function draftFrom(role: PolicyRoleView): string[] {
	return [...role.grants];
}

/**
 * 提交给后端的那一组勾选——**PUT 的请求体就是它的返回值**。
 *
 * 三件事在这一处做完，缺一件都会出事：
 *
 *  1. **按列顺序输出**，与界面上一行的排列一致。请求体里的顺序不影响后端，
 *     但排查问题时把请求和界面对着看会省事。
 *  2. **受保护的格子一律剔除**（isLockedCell）。这是受保护权限不漏进提交
 *     集合的那道闸：界面上那些格子本来就是 disabled，但「点不到」只是第一
 *     层——全选按钮、脚本注入、将来新增的批量操作都会绕开它，数据层必须自己
 *     再挡一次。漏掉的话就是「保存后受保护权限被提交」，后端只能整个请求
 *     拒掉（ApplyRolePermissions 是全有或全无），于是一次无关的改动连带
 *     这次合法的改动一起没了。
 *  3. **只认 columns 里出现过的权限名**。columns 与 roles 来自同一次
 *     GET，天然一致，所以这一步不会误伤任何后端已知的授权；而它挡住的是
 *     草稿里混进来的、连后端都不认识的字符串（那种请求一定 400）。
 *
 * 剩下的一格都没勾时返回 `[]`——那是「把这个角色的权限全部收走」，一次
 * 合法且必要的操作，不是「没有改动」。
 */
export function submittablePermissions(
	role: PolicyRoleView,
	permissions: readonly PolicyPermissionView[],
	checked: readonly string[]
): string[] {
	const wanted = new Set(checked);
	const out: string[] = [];
	for (const perm of permissions) {
		if (isLockedCell(role, perm)) continue;
		if (wanted.has(perm.name)) out.push(perm.name);
	}
	return out;
}

/** 相对「之前那组」的增删。方向必须分开，出事故时要回答的是「谁多了/少了」。 */
export function diffGrants(
	saved: readonly string[],
	submitted: readonly string[]
): { granted: string[]; revoked: string[] } {
	const before = new Set(saved);
	const after = new Set(submitted);
	return {
		granted: [...after].filter((perm) => !before.has(perm)),
		revoked: [...before].filter((perm) => !after.has(perm))
	};
}

/**
 * 当前草稿相对已保存值的增删，用来决定「保存」要不要可点、以及在保存前把
 * 「将新增 X、取消 Y」先说一遍。
 *
 * 基线也走一遍 submittablePermissions：受保护的授权不参与比对。否则脏数据
 * （某个非受保护角色名下真的挂着 system.maintain）会被算成「本次要撤销
 * 一项受保护权限」，界面就会预告一件后端必定拒绝的事。
 */
export function pendingChange(
	role: PolicyRoleView,
	permissions: readonly PolicyPermissionView[],
	checked: readonly string[]
): { granted: string[]; revoked: string[] } {
	return diffGrants(
		submittablePermissions(role, permissions, role.grants),
		submittablePermissions(role, permissions, checked)
	);
}

/**
 * 把一次改动的增删说成人话。
 *
 * 界面上不能只弹一句「保存成功」：权限改动是要事后追责的东西（「谁多了一项
 * 能力」与「谁失去了一项能力」是两种完全不同的事故，后端 audit 里也是分开
 * 记的）。带上中文名是因为看矩阵的人未必认得 `log.export` 这种词表名。
 *
 * 两边都空时回「没有任何变化」——点了一次保存但什么都没改，是合法但没有
 * 后果的操作，说清楚比什么都不说好。
 */
export function describeChange(granted: readonly string[], revoked: readonly string[]): string {
	const label = (perm: string) => `${perm}（${permissionLabel(perm)}）`;
	const parts: string[] = [];
	if (granted.length > 0) parts.push(`新增了 ${granted.map(label).join('、')}`);
	if (revoked.length > 0) parts.push(`取消了 ${revoked.map(label).join('、')}`);
	return parts.length > 0 ? parts.join('；') : '没有任何变化';
}

/**
 * 一次失败的**类别**。
 *
 * 六档而不是一档，因为处置完全不同：前两档是「你这样改不被允许」，中间两档
 * 是「你选的东西已经过期了，刷新一下」，再往后是「这次没生效」与「服务端
 * 状态不对」。合成一句话的话，用户会刷新一百次也刷不出来——受保护那一类
 * 刷多少次都不会变。
 */
export type PolicyFailureKind =
	/** 受保护不可改。界面上那一格本就不该能点，收到它说明前后端对「受保护」的理解已经分叉。 */
	| 'protected'
	/** 角色不存在：多半是刷新之后后端那边角色没了。 */
	| 'stale_role'
	/** 权限不存在：多半是后端加了权限而这个界面还没跟上。 */
	| 'stale_permission'
	/** 请求合法、也写进库了，但重载不通过所以已回滚。 */
	| 'conflict'
	/** 策略表读不出来，或服务端状态不对。 */
	| 'unavailable'
	/** 没带 code 的失败：断网、500、响应格式不对。 */
	| 'unknown';

export interface PolicyFailure {
	kind: PolicyFailureKind;
	/** 后端给的 code；没有就是空串。 */
	code: string;
	/** 直接给用户看的那句话（已包含后端的中文说明）。 */
	message: string;
	/** 该不该重新拉一次策略矩阵。 */
	reload: boolean;
	/** 该不该保留草稿。false = 这次的选择作废，用户得从头再勾一遍。 */
	keepDraft: boolean;
}

/**
 * 把后端的 code 翻成界面该怎么处置。与后端 app/http/controllers 的
 * policyErrorResponse 一一对应。
 *
 * ⚠️ reload 与 keepDraft 都算好返回，不让调用点自己 switch：调用点要同时
 *    用到「要不要刷新」「要不要留草稿」两个判断，逐处 switch 必然会有一处
 *    漏改，而漏改的那处表现成「刷新一次就把用户填好的选择清空了」。
 */
export function policyFailure(code: string | null | undefined, detail: string): PolicyFailure {
	const reason = detail.trim() || '后端没有给出更具体的原因';
	const build = (
		kind: PolicyFailureKind,
		tail: string,
		reload: boolean,
		keepDraft: boolean
	): PolicyFailure => ({
		kind,
		code: code ?? '',
		message: `${reason}。${tail}`,
		reload,
		keepDraft
	});

	switch (code) {
		case 'protected':
			// 刷新是为了让界面上那几格按后端的判断重新变成不可点；留着草稿没有
			// 意义——草稿里如果有受保护的项，那正是它传不上去的原因。
			return build(
				'protected',
				'这一项受保护、不能改，界面上就不该出现可点的入口；已退出编辑并重新读取策略。',
				true,
				false
			);
		case 'unknown_role':
			return build('stale_role', '角色清单可能已经变了，刷新页面后再试。', true, false);
		case 'unknown_permission':
			return build('stale_permission', '权限清单可能已经变了，刷新页面后再试。', true, false);
		case 'policy_conflict':
			// 已回滚，所以数据库与界面都还是原样；用户的选择留着，
			// 刷新看过当前策略之后原样再提交一次即可。
			return build('conflict', '本次没有生效（后端已回滚），请刷新后重试。', true, true);
		case 'policy_unavailable':
			// 策略表读不出来是暂时性的，勾选没白填，不该丢。
			return build(
				'unavailable',
				'服务端暂时读不出策略表，你勾的内容已保留，稍后重试即可。',
				true,
				true
			);
		default:
			// 没带 code 的失败（断网、500、格式异常）不该乱丢用户的选择，
			// 但也不能断言「刷新一下就好」，所以不自动刷新。
			return { kind: 'unknown', code: code ?? '', message: reason, reload: false, keepDraft: true };
	}
}
