import { describe, expect, it } from 'vitest';
import {
	PERMISSIONS,
	PERMISSION_LABELS,
	hasPermission,
	isPermission,
	permissionLabel
} from './rbac';
import { BACKEND_LABELS, BACKEND_PERMISSIONS, POLICY_BY_ROLE } from './rbac.fixture';

/**
 * 这份测试的职责：把前端这份**权限词表副本**钉在后端 app/rbac 的真实值上，
 * 并把「给定权限清单能不能过某道门」这个判定钉死。
 *
 * 为什么需要它：界面判断「该不该显示这个按钮 / 能不能进这个页面」用的是权限名，
 * 而权限名只有一个定义（后端 app/rbac/rbac.go 的 Perm*），于是它在前端被抄了
 * 一份。抄错了没有任何编译错误、没有运行时异常，只是某个按钮该藏没藏、
 * 或者某个页面凭空消失。
 *
 * 最阴的一种是**多写或少写一个权限**：门槛变成「谁都过不了」，页面凭空消失；
 * 反过来把门槛抄成一个几乎没人持有的权限，则整页对所有人关闭。
 *
 * 抄写内容放在 rbac.fixture.ts（测试夹具，不要从产品代码 import）。
 */

describe('前端权限词表与后端 app/rbac 一致', () => {
	it('权限名逐个相同，顺序也相同', () => {
		// 顺序有意义：它同时是「从看到删系统」的阅读顺序与文档里出现的顺序。
		expect([...PERMISSIONS]).toEqual(BACKEND_PERMISSIONS);
	});

	it('中文名逐个相同，不多也不少', () => {
		expect({ ...PERMISSION_LABELS }).toEqual(BACKEND_LABELS);
	});

	it('isPermission 只认已声明的权限名', () => {
		for (const perm of PERMISSIONS) {
			expect(isPermission(perm), perm).toBe(true);
		}
		// 大小写与前后空格都不是同一项权限：手滑写出来时必须在编译之外也被拒。
		expect(isPermission('user.Manage')).toBe(false);
		expect(isPermission(' user.manage')).toBe(false);
		expect(isPermission('user.managee')).toBe(false);
		expect(isPermission('')).toBe(false);
	});

	it('未知权限名原样返回权限名本身，便于一眼看出拼错了', () => {
		expect(permissionLabel('user.managee')).toBe('user.managee');
		expect(permissionLabel('user.manage')).toBe('增删账号、调整角色');
	});
});

describe('hasPermission', () => {
	it('12 个权限名各自的 true/false 都对', () => {
		// 每个权限单独给一份「只有它」的清单，逐项断言：
		// 持有 → true，其余 11 项 → false。这一条同时覆盖「漏判」与「误判」。
		for (const held of PERMISSIONS) {
			const granted = [held];
			for (const perm of PERMISSIONS) {
				expect(hasPermission(granted, perm), `${granted} 对 ${perm}`).toBe(perm === held);
			}
		}
	});

	it('空清单 / null / undefined 一律拒绝', () => {
		// fail-closed：登录态还没恢复、令牌刚失效这两种时刻权限都是空的，
		// 那一刻界面上必须什么都看不到。
		for (const perm of PERMISSIONS) {
			expect(hasPermission([], perm), perm).toBe(false);
			expect(hasPermission(null, perm), perm).toBe(false);
			expect(hasPermission(undefined, perm), perm).toBe(false);
		}
	});

	it('未声明的权限名一律拒绝，哪怕清单里正好有它', () => {
		// 与后端 rbac.Can 的「权限名未知 → 拒，并打日志」一致。
		// 反过来放行的话，调用点一个错字就等于把「写错了」变成「静默放行」。
		expect(hasPermission(['user.managee'], 'user.managee')).toBe(false);
		expect(hasPermission(PERMISSIONS, 'system.maintan')).toBe(false);
	});

	it('多给几项权限时各项互不影响', () => {
		const granted = ['user.view', 'log.export'];
		expect(hasPermission(granted, 'user.view')).toBe(true);
		expect(hasPermission(granted, 'log.export')).toBe(true);
		expect(hasPermission(granted, 'user.manage')).toBe(false);
		expect(hasPermission(granted, 'project.member')).toBe(false);
	});
});

/**
 * 一个角色的完整权限集逐项比对。
 *
 * 这是「迁移后谁该看到什么」最直接的答案：负责人（leader）拿得到 user.view，
 * 所以他**应该**看得到用户列表；拿不到 user.manage，所以他**不应该**看得到
 * 「新建用户 / 改角色 / 删除」。前端此前按角色名判断，两头都判错。
 */
describe('负责人（leader）的权限集逐项比对', () => {
	const leader = POLICY_BY_ROLE.leader;

	it('持有的 6 项逐项为 true', () => {
		for (const perm of leader) {
			expect(hasPermission(leader, perm), `leader 应持有 ${perm}`).toBe(true);
		}
		expect(leader).toHaveLength(6);
	});

	it('其余 6 项逐项为 false', () => {
		const missing = BACKEND_PERMISSIONS.filter((perm) => !leader.includes(perm));
		for (const perm of missing) {
			expect(hasPermission(leader, perm), `leader 不应持有 ${perm}`).toBe(false);
		}
		expect(missing).toEqual([
			'audit.view',
			'switch.operate',
			'log.cleanup',
			'project.manage',
			'user.manage',
			'system.maintain'
		]);
	});
});

/**
 * 三个能登录网页后台的角色（负责人及以上）逐项比对。
 *
 * 网页后台只有负责人以上能进（后端 admin_min_role=leader），所以导播/包装/解说/
 * 前期/后勤根本进不来这张表——但策略仍要完整钉住，否则将来放开后台门槛时，
 * 前端那份副本早就与后端脱节了。
 */
describe('各角色的完整权限集与后端 policy.csv 一致', () => {
	it('逐角色逐项比对，不多也不少', () => {
		for (const [role, expected] of Object.entries(POLICY_BY_ROLE)) {
			for (const perm of BACKEND_PERMISSIONS) {
				expect(hasPermission(expected, perm), `${role} 对 ${perm}`).toBe(expected.includes(perm));
			}
		}
	});

	it('超管持有全部 12 项', () => {
		for (const perm of BACKEND_PERMISSIONS) {
			expect(hasPermission(POLICY_BY_ROLE.super_admin, perm), perm).toBe(true);
		}
		expect(POLICY_BY_ROLE.super_admin).toHaveLength(12);
	});

	it('system.maintain 只有超管一行（后端受保护权限的语义前提）', () => {
		for (const [role, granted] of Object.entries(POLICY_BY_ROLE)) {
			expect(hasPermission(granted, 'system.maintain'), role).toBe(role === 'super_admin');
		}
	});

	it('switch.operate 是不连续的一组：导播有，负责人没有', () => {
		// 这一组正是等级制表达不了的形状：负责人(40) 比导播(30) 高，
		// 任何 AtLeast(director) 的门槛都会把负责人放进来，而业务上他不参与
		// 导播工作。前端若退回按角色判断，这里就会算错。
		expect(hasPermission(POLICY_BY_ROLE.director, 'switch.operate')).toBe(true);
		expect(hasPermission(POLICY_BY_ROLE.leader, 'switch.operate')).toBe(false);
		expect(hasPermission(POLICY_BY_ROLE.admin, 'switch.operate')).toBe(true);
	});

	it('负责人有 user.view 但没有 user.manage：能看人，不能改人', () => {
		expect(hasPermission(POLICY_BY_ROLE.leader, 'user.view')).toBe(true);
		expect(hasPermission(POLICY_BY_ROLE.leader, 'user.manage')).toBe(false);
	});
});
