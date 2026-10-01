/**
 * 角色的展示辅助。
 *
 * 之前每个页面各自写一份 `role === 'admin' ? '管理员' : '导播'`，
 * 加了超级管理员之后全部会把超管显示成「导播」。这里集中成一处。
 *
 * 中文名优先取后端给的（ListUsers 的 role_label、/api/roles 的 label）——
 * 后端才是唯一事实来源；本地表只在接口没给时兜底。
 */
import { ROLE_LABELS, ROLE_LEVELS, type Role } from '$lib/api/types';

/** Tag 组件支持的配色。 */
export type RoleTagState = 'theme' | 'success' | 'warning' | 'error' | 'info' | 'neutral';

/** 把角色翻成中文。未知值原样返回，便于排查脏数据。 */
export function roleLabel(role: string): string {
	return ROLE_LABELS[role as Role] ?? role;
}

/**
 * 本地判断是否达到某角色等级，语义与后端 Role.AtLeast 一致。
 *
 * min 收 string 而不是 Role：这里要比的常常是「数据库里那个人的角色」，
 * 类型是 string 而非字面量联合。未知角色按等级 0 处理，于是任何守卫都会拒它——
 * 与后端 roleLevels 查不到时返回 0 的行为一致。
 */
export function roleAtLeast(role: string | undefined, min: string): boolean {
	if (!role) return false;
	return (ROLE_LEVELS[role as Role] ?? 0) >= (ROLE_LEVELS[min as Role] ?? 0);
}

/**
 * 角色对应的标签配色：权限越高颜色越醒目。
 *
 * 未知角色用 neutral——刻意不给 theme（那是有含义的主色），
 * 一眼能看出这是个不该出现的值。
 */
const roleStates: Record<Role, RoleTagState> = {
	super_admin: 'error',
	admin: 'warning',
	leader: 'info',
	pre_production: 'theme',
	logistics: 'neutral',
	director: 'success'
};

export function roleState(role: string): RoleTagState {
	return roleStates[role as Role] ?? 'neutral';
}

/** 「超管」「管理员」这类短标签，用于空间紧凑的地方（表格单元）。 */
const shortLabels: Record<Role, string> = {
	super_admin: '超管',
	admin: '管理员',
	leader: '负责人',
	pre_production: '前期',
	logistics: '后勤',
	director: '导播'
};

export function roleShortLabel(role: string): string {
	return shortLabels[role as Role] ?? role;
}

/** 判断「谁能改谁」只需要 id 与 role，够用就别把整个 User 拖进来。 */
interface RoleActor {
	id: number;
	role: string;
}

/**
 * 某个用户可以被改成哪些角色。
 *
 * 四道过滤，语义与后端 decideRoleChange 一一对应（后端仍会再挡一次，
 * 这里只是不给出注定失败的选项）：
 *  - 操作者至少是管理员，否则根本不该出现这个下拉；
 *  - 目标的权限不能高于自己，否则改不动；
 *  - 只能授予不高于自己的角色；
 *  - 排除当前角色本身。
 *
 * 单独不对自己提供降级：后端一律返回「不能降低自己的权限」。
 *
 * ⚠️ 这里判的全是**操作者**，不是被改的那个人。
 * 这个判断曾经写成 `roleAtLeast(user.role, 'admin')`——拿目标自己的角色
 * 去问「你至少是管理员吗」，于是超管看负责人那一行时算出 40 >= 50 为假，
 * 整个下拉被藏掉，现场表现为「超级管理员改不了负责人的权限组」。
 *
 * 抽成纯函数而不是留在组件里：越权判断是最该有测试覆盖的地方，
 * 而组件内的局部函数没法单测（见 version.ts 的同类理由）。
 */
export function switchableRoles(
	actor: RoleActor | null | undefined,
	target: RoleActor,
	all: readonly string[]
): string[] {
	if (!actor || !actor.role) return [];
	// 改角色是对人的管理动作，最低要管理员（后端 decideRoleChange 的第一条）。
	if (!roleAtLeast(actor.role, 'admin')) return [];
	// 目标比自己权限高时改不动，就别给出这个下拉。
	if (!roleAtLeast(actor.role, target.role)) return [];
	const isSelf = actor.id === target.id;
	return all.filter((role) => {
		if (role === target.role) return false;
		// 不能授予高于自己的角色（后端 guardGrant）。
		if (!roleAtLeast(actor.role as string, role)) return false;
		// 不能把自己降级（后端对 self 单独有一条拒绝）。
		// 升到超管会被上面那条挡掉，所以这里剩下的只能是「同等级」——
		// 而同等级且不是当前角色的候选实际上不存在，这一行通常是空转的。
		if (isSelf && !roleAtLeast(role, actor.role as string)) return false;
		return true;
	});
}
