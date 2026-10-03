/**
 * 权限词表与权限判定，对应后端 app/rbac。
 *
 * 为什么前端要有一份权限名：后端把路由准入从「角色等级门槛」换成了 Casbin 的
 * 具名权限，界面要按权限名决定「该不该显示这个按钮」，就必须能说出权限的名字。
 * 名字只有一份定义（后端 app/rbac/rbac.go 的 Perm*），抄错一个字符的后果是
 * 那道门槛变成「谁都过不了」，页面凭空消失且不报错——所以这份清单由
 * rbac.test.ts 钉住。
 *
 * ⚠️ 这里**只**放权限，不放角色。角色名（$lib/roles、$lib/api/types 的
 *    ROLE_LEVELS）仍然用于展示（「你是 负责人」）与控制器层的「能否操作他人」
 *    判断，两者是叠加关系，不是一套换另一套。
 *
 * ⚠️ 权限只决定「能不能进这个页面、看不看得见这些按钮」。真正的判定始终在
 *    后端，这里写错最坏也只是多点一下换来一个 403，不会越权。
 */

/**
 * 全部 12 项权限，顺序与后端 app/rbac/rbac.go 的 permissionNames 一致
 * （也就是 policy.csv 的分块顺序：从「看」到「删系统」）。
 *
 * 抄错或漏抄都要靠 rbac.test.ts 抓，所以这里的顺序也有意义：它同时是
 * 「谁该看到什么」在代码里的排列顺序。
 */
export const PERMISSIONS = [
	'log.view',
	'project.view',
	'user.view',
	'audit.view',
	'log.export',
	'interview.manage',
	'project.member',
	'switch.operate',
	'log.cleanup',
	'project.manage',
	'user.manage',
	'system.maintain'
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * 权限的中文名，与后端 app/rbac/rbac.go 的 permissionLabels 一致。
 *
 * 为什么必须有：403 与「没有访问权限」页面的文案不能是「权限不足」四个字——
 * 收到这句话的人既不知道缺的是哪一项，也不知道该找谁，只能挨个试。
 */
export const PERMISSION_LABELS: Record<Permission, string> = {
	'log.view': '查看协调日志',
	'project.view': '查看项目列表、详情、机位、切台记录与统计',
	'user.view': '查看用户列表',
	'audit.view': '查看操作审计',
	'log.export': '导出协调日志',
	'interview.manage': '管理采访点',
	'project.member': '授权/回收项目成员',
	'switch.operate': '操作切台（获取/释放/续期控制权）',
	'log.cleanup': '清理协调日志',
	'project.manage': '创建/修改/删除项目与机位预设',
	'user.manage': '增删账号、调整角色',
	'system.maintain': '查看系统信息、运行指标与执行在线更新'
};

/** 权限名是否已声明。用于把「界面拼错的权限名」与「后端发的权限名」区分开。 */
export function isPermission(perm: string): perm is Permission {
	return (PERMISSIONS as readonly string[]).includes(perm);
}

/** 权限的中文名；未知名字原样返回，便于一眼看出拼错了。 */
export function permissionLabel(perm: string): string {
	return isPermission(perm) ? PERMISSION_LABELS[perm] : perm;
}

/**
 * 报告 granted 里有没有这一项权限。**任何不确定都返回 false。**
 *
 * fail-closed 与后端 rbac.Can 同一个原则，逐条对应：
 *   - granted 为空 / null / undefined → 拒。登录态没恢复完、或令牌刚失效，
 *     这两种时刻都必须是「什么都看不到」，否则会闪出一屏本不该出现的按钮。
 *   - 权限名未声明 → 拒。调用点拼错一个字时不能悄悄放行，那等于把
 *     「写错了」变成「静默越权」。未知名字在这里的表现与后端
 *     「权限名未知 → 拒，并打日志」一致。
 *
 * 抽成纯函数（收数组、不读 store）是为了能单测：权限判断是最该有测试覆盖的
 * 一段逻辑，而组件里的局部函数没法单测。
 */
export function hasPermission(
	granted: readonly string[] | null | undefined,
	perm: string
): boolean {
	if (!granted || !isPermission(perm)) return false;
	return granted.includes(perm);
}
