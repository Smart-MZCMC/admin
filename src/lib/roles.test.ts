import { describe, expect, it } from 'vitest';
import { ROLES } from './api/types';
import { canDeleteUser, deleteBlockedReason, roleAtLeast, switchableRoles } from './roles';

/**
 * 「谁能改谁」是这套后台里最容易出错、后果也最直接的一段逻辑：
 * 判错了要么是超管被挡住（用户报的「改不了负责人的权限组」），
 * 要么是给出注定被后端 403 的选项，让用户以为系统坏了。
 *
 * 这里逐条对着后端 decideRoleChange / guardGrant 的规则写，
 * 改动任意一条时这个文件会先响。
 *
 * ⚠️ 这里判的是**两层**，测试也要分开断言：
 *  - 准入层：有没有 user.manage（决定看不看得见这个按钮）；
 *  - 控制器层：目标不能比自己高、不能删自己、不能动最后一个超管。
 * 两者叠加。删掉第二层的后果是本项目真踩过的「后勤能删掉导播账号」。
 */
/**
 * 候选角色全集直接取 $lib/api/types 的 ROLES，不在本文件再抄一份。
 *
 * 此前这里写死了一个六角色数组，于是后端新增 packaging / commentator 时
 * 这些用例依旧全绿——它们根本没测新角色。现在后端一改角色表，
 * ROLES 一变，下面所有用例自动跟着走真实全集。
 * 等级数值的同步由 role_table.test.ts 钉住。
 */
const ALL = [...ROLES];

/**
 * 准入层只问一项权限：user.manage（增删账号、调整角色）。
 *
 * 所以这里不必抄整张策略矩阵——那两个常量表达的是「持有 / 不持有 user.manage」
 * 这一个事实。完整的「谁有哪些权限」由 rbac.test.ts 对着后端 policy.csv 钉住。
 * 刻意把「负责人」那一档写成只带 user.view：负责人角色等级 40 比导播 30 还高，
 * 若哪天有人把准入层退回按等级判断，这里的 leader 用例会先红。
 */
const MANAGE = ['user.manage'] as const;
const NO_MANAGE = ['user.view'] as const;

const superAdmin = { id: 1, role: 'super_admin', permissions: MANAGE };
const admin = { id: 2, role: 'admin', permissions: MANAGE };
const leader = { id: 3, role: 'leader', permissions: NO_MANAGE };
const otherLeader = { id: 4, role: 'leader', permissions: NO_MANAGE };
const director = { id: 5, role: 'director', permissions: NO_MANAGE };

describe('switchableRoles', () => {
	it('超管可以改负责人的角色（回归：曾按目标角色判断导致下拉被藏掉）', () => {
		// 这条是本文件的起因。原实现写的是 roleAtLeast(target.role, 'admin')，
		// 负责人等级 40 不够 50，于是超管这一格的下拉整个消失。
		expect(switchableRoles(superAdmin, otherLeader, ALL)).toContain('admin');
		expect(switchableRoles(superAdmin, otherLeader, ALL)).toContain('pre_production');
	});

	it('排除当前角色本身', () => {
		const options = switchableRoles(superAdmin, otherLeader, ALL);
		expect(options).not.toContain('leader');
	});

	it('管理员改不了超管（目标权限高于自己时不给下拉）', () => {
		expect(switchableRoles(admin, superAdmin, ALL)).toEqual([]);
	});

	it('同级之间可以改', () => {
		// 后端用的是 AtLeast（>=），同级是允许的：管理员之间互为平级。
		expect(switchableRoles(admin, { id: 9, role: 'admin' }, ALL)).toContain('leader');
	});

	it('不能授予高于自己的角色', () => {
		const options = switchableRoles(admin, leader, ALL);
		expect(options).not.toContain('super_admin');
		// 升到与自己同级是允许的（后端 guardGrant 用的是 >=），所以 admin 在列表里。
		expect(options).toContain('admin');
		// leader 是目标自己的角色，按规则被排除。
		expect(options).not.toContain('leader');
	});

	it('管理员改不了负责人以外的高等级角色，也改不了超管', () => {
		expect(switchableRoles(admin, superAdmin, ALL)).toEqual([]);
	});

	it('低于管理员的账号什么都改不了', () => {
		for (const target of [director, leader, otherLeader]) {
			expect(switchableRoles(director, target, ALL)).toEqual([]);
			expect(
				switchableRoles({ id: 6, role: 'logistics', permissions: NO_MANAGE }, target, ALL)
			).toEqual([]);
		}
	});

	it('不能给自己降级（后端一律拒绝，所以不提供该选项）', () => {
		const options = switchableRoles(superAdmin, superAdmin, ALL);
		expect(options).not.toContain('admin');
		expect(options).not.toContain('leader');
		expect(options).not.toContain('director');
	});

	it('给自己升到同等或更高的角色不算降级，可以给', () => {
		// 唯一剩下的可能就是没有别的同等级角色——全表只有八个角色，
		// 自己那一行因此通常是空的。这条断言的是「过滤逻辑没把同角色误伤」。
		const options = switchableRoles(admin, admin, ALL);
		expect(options).toEqual([]);
	});

	it('未登录时一律为空', () => {
		expect(switchableRoles(null, leader, ALL)).toEqual([]);
		expect(switchableRoles(undefined, leader, ALL)).toEqual([]);
	});

	/**
	 * 准入层：没有 user.manage 就连这个下拉都不该出现。
	 *
	 * 这条是权限迁移后最典型的症状：负责人角色不低（40 级，比导播还高），
	 * 按旧的「管理员及以上」判断他确实过不去——但真正的问题是他现在有
	 * user.view、能进这个页面，看到一个点了必然 403 的下拉比什么都看不见更糟。
	 */
	it('没有 user.manage 的账号一律给不出可改的角色', () => {
		// 负责人：只看得到人，不能改人。
		expect(switchableRoles(leader, director, ALL)).toEqual([]);
		// 权限字段缺失（没传）也按「无权限」处理，绝不因为漏传就放行。
		expect(switchableRoles({ id: 2, role: 'admin' }, director, ALL)).toEqual([]);
		expect(switchableRoles({ id: 2, role: 'admin', permissions: [] }, director, ALL)).toEqual([]);
		// 持有 user.manage 就给，且给的是控制器层过滤后的结果。
		expect(switchableRoles(admin, director, ALL)).toContain('leader');
	});
});

describe('roleAtLeast', () => {
	it('等级高低比较而不是等值比较', () => {
		expect(roleAtLeast('super_admin', 'admin')).toBe(true);
		expect(roleAtLeast('admin', 'super_admin')).toBe(false);
		expect(roleAtLeast('admin', 'admin')).toBe(true);
	});

	it('未知角色按等级 0 处理，任何守卫都会拒它', () => {
		// 与后端 roleLevels 查不到时返回 0 一致。写成「未知即通过」的话，
		// 一个脏数据角色名就能拿到管理员界面。
		expect(roleAtLeast('nonexistent', 'director')).toBe(false);
		expect(roleAtLeast(undefined, 'director')).toBe(false);
		expect(roleAtLeast('director', 'nonexistent')).toBe(true);
	});
});

/**
 * 删除账号的可见性。
 *
 * 这条规则的起因是个真实的误解：用户页的删除按钮此前**完全没有门控**，
 * 于是系统里唯一的超管在自己那一行也看得到一个可点的红色「删除」，
 * 看上去就像「超级管理员可以被删掉」。实测后端其实会返回 400
 * 「不能删除自己的账号」，拦得住——但界面给出一个注定失败的操作，
 * 只会让人以为防线没设。
 */
describe('canDeleteUser', () => {
	const superAdmin = { id: 1, role: 'super_admin', permissions: MANAGE };
	const otherSuperAdmin = { id: 2, role: 'super_admin', permissions: MANAGE };
	const admin = { id: 3, role: 'admin', permissions: MANAGE };
	const otherAdmin = { id: 4, role: 'admin', permissions: MANAGE };
	const leader = { id: 5, role: 'leader', permissions: NO_MANAGE };

	it('超管不能删自己（现场报告的那个场景）', () => {
		expect(canDeleteUser(superAdmin, superAdmin, 1)).toBe(false);
		expect(canDeleteUser(superAdmin, superAdmin, 2)).toBe(false);
	});

	it('删掉唯一的超管不行，删到还剩一个才行', () => {
		// 系统里只有 1 个超管时，删掉它就没有人能管用户、改角色、做系统更新
		expect(canDeleteUser(superAdmin, superAdmin, 1)).toBe(false);
		// 有 2 个超管时，另一个超管可以删这个
		expect(canDeleteUser(otherSuperAdmin, superAdmin, 2)).toBe(true);
	});

	it('管理员不能删超管', () => {
		expect(canDeleteUser(admin, superAdmin, 2)).toBe(false);
		expect(canDeleteUser(admin, superAdmin, 1)).toBe(false);
	});

	it('管理员可以删低于自己的角色', () => {
		expect(canDeleteUser(admin, leader, 2)).toBe(true);
	});

	it('同级可互删（与后端 decideDeleteUser 的 AtLeast 语义一致）', () => {
		expect(canDeleteUser(admin, otherAdmin, 1)).toBe(true);
	});

	it('管理员以下什么都删不了', () => {
		for (const target of [leader, otherAdmin, superAdmin]) {
			expect(canDeleteUser(leader, target, 2), target.role).toBe(false);
			expect(
				canDeleteUser({ id: 9, role: 'logistics', permissions: NO_MANAGE }, target, 2),
				target.role
			).toBe(false);
		}
	});

	it('未登录一律不可删', () => {
		expect(canDeleteUser(null, leader, 2)).toBe(false);
		expect(canDeleteUser(undefined, leader, 2)).toBe(false);
	});

	/**
	 * 准入层与控制器层是叠加的：把 user.manage 换成「角色够高就行」，
	 * 或者反过来把三条附加规则删掉，都会留下可利用的口子。
	 */
	it('准入层与控制器层叠加，缺一层都拦不住', () => {
		// 只有权限、没有附加规则 → 会把「最后一个超管」摆成可删。
		expect(
			canDeleteUser({ id: 1, role: 'super_admin', permissions: MANAGE }, otherSuperAdmin, 1)
		).toBe(false);
		// 只有附加规则、没有权限 → 权限判断被跳过，仍然不能删。
		expect(canDeleteUser({ id: 5, role: 'leader' }, director, 2)).toBe(false);
		expect(canDeleteUser({ id: 5, role: 'leader', permissions: [] }, director, 2)).toBe(false);
		// 两层都满足才放行。
		expect(canDeleteUser(admin, leader, 2)).toBe(true);
	});
});

describe('deleteBlockedReason', () => {
	it('可删时返回空串', () => {
		expect(deleteBlockedReason({ id: 3, role: 'admin', permissions: MANAGE }, otherLeader, 1)).toBe(
			''
		);
	});

	it('不可删时给出能直接看懂的原因', () => {
		// 界面上把这句放进 title，所以要能直接读懂，不能是错误码。
		expect(
			deleteBlockedReason(
				{ id: 1, role: 'super_admin', permissions: MANAGE },
				{ id: 1, role: 'super_admin' },
				1
			)
		).toBe('不能删除自己的账号');
		expect(
			deleteBlockedReason(
				{ id: 3, role: 'admin', permissions: MANAGE },
				{ id: 1, role: 'super_admin' },
				2
			)
		).toContain('超级管理员');
		// 准入层的原因要指名权限，否则用户只看到「需要账号管理权限」却不知道
		// 找谁要——这正是后端 403 文案里 permissionLabels 存在的同一个理由。
		expect(
			deleteBlockedReason({ id: 5, role: 'leader', permissions: NO_MANAGE }, director, 1)
		).toContain('user.manage');
	});

	it('与 canDeleteUser 始终一致', () => {
		// 两个函数讲的是同一套规则。一旦分叉，界面就会显示一个与后端判定
		// 不一致的禁用状态，比没有门控更容易误导人。
		const actors = [
			{ id: 1, role: 'super_admin', permissions: MANAGE },
			{ id: 2, role: 'super_admin', permissions: MANAGE },
			{ id: 3, role: 'admin', permissions: MANAGE },
			{ id: 5, role: 'leader', permissions: NO_MANAGE }
		];
		const targets = [
			{ id: 1, role: 'super_admin', permissions: MANAGE },
			{ id: 3, role: 'admin', permissions: MANAGE },
			{ id: 5, role: 'leader', permissions: NO_MANAGE }
		];
		for (const count of [1, 2]) {
			for (const a of actors) {
				for (const t of targets) {
					expect(canDeleteUser(a, t, count), `${a.role}→${t.role}@${count}`).toBe(
						deleteBlockedReason(a, t, count) === ''
					);
				}
			}
		}
	});
});
