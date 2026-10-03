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
import { hasPermission, type Permission } from '$lib/rbac';

/**
 * 准入层那道门，与后端 rbac.PermUserManage 一字不差。
 *
 * `satisfies Permission` 不是装饰：权限名抄错一个字时编译期就报，而不是等到
 * 线上表现为「所有人都过不了这道门槛」。
 */
const PERM_USER_MANAGE = 'user.manage' satisfies Permission;

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
	director: 'success',
	packaging: 'info',
	commentator: 'theme',
	pre_production: 'theme',
	logistics: 'neutral'
};

export function roleState(role: string): RoleTagState {
	return roleStates[role as Role] ?? 'neutral';
}

/** 「超管」「管理员」这类短标签，用于空间紧凑的地方（表格单元）。 */
const shortLabels: Record<Role, string> = {
	super_admin: '超管',
	admin: '管理员',
	leader: '负责人',
	director: '导播',
	packaging: '包装',
	commentator: '解说',
	pre_production: '前期',
	logistics: '后勤'
};

export function roleShortLabel(role: string): string {
	return shortLabels[role as Role] ?? role;
}

/**
 * 判断「谁能操作谁」所需的操作者信息。
 *
 * 这里同时装着**两层**判断所需的东西，别把它们混为一谈：
 *  - `permissions` 回答「能不能进这个接口/看不看得见这个按钮」，来自
 *    GET /api/auth/permissions，是准入层；
 *  - `role` 回答「进到里面之后能不能操作这个人」，是控制器层
 *    （后端 decideRoleChange / decideDeleteUser / guardLastSuperAdmin）。
 *
 * 两层是**叠加**关系，不是一套换另一套：把下面 user.manage 的那一条换成
 * 「有权限就随你操作」，第一个管理员登录就能给自己升成超管；而把后面三条
 * 附加规则删掉，后果是本项目真踩过的「后勤能删掉导播账号」。
 *
 * `permissions` 可选是因为有些调用点（角色清单渲染）确实不需要它——但
 * **准入判断一律按空数组处理（fail-closed）**，绝不会因为没传就放行。
 */
export interface RoleActor {
	id: number;
	role: string;
	/** 当前账号的生效权限（GET /api/auth/permissions）。 */
	permissions?: readonly string[];
}

/** 准入层：没有 user.manage 就连这个页面/按钮都碰不到，后端会先 403。 */
function mayManageUsers(actor: RoleActor): boolean {
	return hasPermission(actor.permissions, PERM_USER_MANAGE);
}

/**
 * 某个用户可以被改成哪些角色。
 *
 * 准入层（后端 RequirePermission）只有一条：user.manage。它决定的是「能不能
 * 进这个接口」——迁移前这里是「管理员及以上」，与角色名绑定；现在必须按权限名
 * 问，否则负责人（只有 user.view）会在用户页看到一个点了必定 403 的下拉。
 *
 * 进到里面之后，语义与后端 decideRoleChange 逐条对应（后端仍会再挡一次，
 * 这里只是不给出注定失败的选项）——这三条**不是权限问题**，别跟着改：
 *  - 目标的权限不能高于自己，否则改不动；
 *  - 只能授予不高于自己的角色；
 *  - 排除当前角色本身（且不对自己提供降级）。
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
	if (!mayManageUsers(actor)) return [];
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

/**
 * 能否删除某个账号，语义与后端 decideDeleteUser + guardLastSuperAdmin 一致。
 *
 * 后端是真正的判定方，这里只决定「要不要把删除按钮摆出来」。摆出一个
 * 点了必定失败的操作比没有更糟：用户会以为防线没设，或者以为系统出了 bug。
 *
 * 分两层写，缺任何一层都会出事：
 *
 * **准入层**：user.manage。这条是后端 RequirePermission 管的「能不能进这个接口」，
 * 所以按钮显隐必须问权限名而不是角色名——否则负责人（只有 user.view）在用户页
 * 会看到一个点了必定 403 的删除按钮。
 *
 * **控制器层**（这三条不是权限问题，权限再大也拦得住，**不要因为改成权限判断
 * 就把它们删掉**）：
 *  - 不能删自己。删掉就再也进不来了。
 *  - 不能删权限不低于自己的。删账号是管理动作，与「我等级比你高」无关——
 *    按等级推导会得出「后勤能删导播」这种荒唐结果。
 *  - 目标是超管时，系统里必须还有别的超管，否则删掉就没人能管用户、改角色、
 *    做系统更新，只能回服务器手改数据库。
 *
 * ⚠️ 这几条判断的对象是**操作者**（actor），不是被删的那个人。
 * 用户页此前对删除按钮完全没有门控，于是每个人（包括唯一的超管本人）
 * 都看得到一个点了必定 400 的删除按钮，看上去就像「超管可以被删掉」。
 */
export function canDeleteUser(
	actor: RoleActor | null | undefined,
	target: RoleActor,
	superAdminCount: number
): boolean {
	if (!actor || !actor.role) return false;
	if (!mayManageUsers(actor)) return false;
	if (actor.id === target.id) return false;
	if (!roleAtLeast(actor.role, target.role)) return false;
	// 目标是超管时，要保证删完还剩下至少一个。
	if (target.role === 'super_admin' && superAdminCount <= 1) return false;
	return true;
}

/** 同级之间能不能互删（用于给用户一个明确的解释，而不是让人猜规则）。 */
export function deleteBlockedReason(
	actor: RoleActor | null | undefined,
	target: RoleActor,
	superAdminCount: number
): string {
	if (!actor || !actor.role) return '未登录';
	if (!mayManageUsers(actor)) return '需要账号管理权限（user.manage）';
	if (actor.id === target.id) return '不能删除自己的账号';
	if (!roleAtLeast(actor.role, target.role)) return `不能删除${roleLabel(target.role)}或更高角色`;
	if (target.role === 'super_admin' && superAdminCount <= 1)
		return '系统至少需要保留一个超级管理员';
	return '';
}
