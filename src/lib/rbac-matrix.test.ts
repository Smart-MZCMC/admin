import { describe, expect, it } from 'vitest';
import {
	describeChange,
	diffGrants,
	draftFrom,
	isLockedCell,
	pendingChange,
	policyFailure,
	sortedRoles,
	submittablePermissions,
	type PolicyFailureKind
} from './rbac-matrix';
import {
	ROLES,
	ROLE_LABELS,
	ROLE_LEVELS,
	type PolicyPermissionView,
	type PolicyRoleView
} from './api/types';
import { BACKEND_LABELS, BACKEND_PERMISSIONS, POLICY_BY_ROLE } from './rbac.fixture';

/**
 * 权限矩阵的三道闸，逐条钉住。
 *
 * 这一页的门槛是 system.maintain——不可撤销、且一旦没人持有就没有任何界面能
 * 恢复的权限。它是「谁能改权限」的唯一入口，所以它自己的判断出错没有兜底。
 * 下面四组用例就是那几道兜底本身：
 *  1. 受保护的格子进不了提交集合（数据层，不只是「点不到」）；
 *  2. 草稿与已保存值是两个数组；
 *  3. 一项都没勾时提交空数组，而不是「不提交」；
 *  4. 五种 code 各落到自己的处置分支上。
 *
 * 矩阵夹具直接由 rbac.fixture 的后端 policy.csv 副本生成，所以后端策略一改，
 * 这些用例自动跟着走真实形状，不会在旁边留一份永远不变的假数据。
 */

/** 后端 app/rbac/protect.go 的两份受保护清单（目前各只有一项）。 */
const PROTECTED_PERMISSIONS = new Set(['system.maintain']);
const PROTECTED_ROLES = new Set(['super_admin']);

function matrix(): { permissions: PolicyPermissionView[]; roles: PolicyRoleView[] } {
	const permissions = BACKEND_PERMISSIONS.map((name) => ({
		name,
		label: BACKEND_LABELS[name],
		protected: PROTECTED_PERMISSIONS.has(name),
		holders: ROLES.filter((role) => POLICY_BY_ROLE[role]?.includes(name))
	}));
	const roles = ROLES.map((value) => ({
		value,
		label: ROLE_LABELS[value],
		level: ROLE_LEVELS[value],
		protected: PROTECTED_ROLES.has(value),
		grants: [...POLICY_BY_ROLE[value]]
	}));
	return { permissions, roles };
}

/** 取一个角色，取不到就让测试当场炸在有意义的行号上，而不是后面某个 undefined 上。 */
function roleOf(roles: PolicyRoleView[], value: string): PolicyRoleView {
	const role = roles.find((r) => r.value === value);
	if (!role) throw new Error(`夹具里没有角色 ${value}`);
	return role;
}

describe('isLockedCell', () => {
	it('受保护的权限那一列、 受保护的角色那一行都是死的', () => {
		const { permissions, roles } = matrix();
		const systemMaintain = permissions.find((p) => p.name === 'system.maintain');
		const admin = roleOf(roles, 'admin');
		if (!systemMaintain) throw new Error('夹具里没有 system.maintain');

		// 权限受保护 → 与角色无关，整列都不可点（包括管理员这种普通角色）。
		expect(isLockedCell(admin, systemMaintain)).toBe(true);
		expect(isLockedCell(roleOf(roles, 'logistics'), systemMaintain)).toBe(true);
		// 角色受保护 → 与权限无关，整行都不可点（包括 log.view 这种随便给的权限）。
		expect(isLockedCell(roleOf(roles, 'super_admin'), permissions[0])).toBe(true);
	});

	it('普通角色上的普通权限是可改的', () => {
		const { permissions, roles } = matrix();
		const logView = permissions.find((p) => p.name === 'log.view');
		if (!logView) throw new Error('夹具里没有 log.view');
		expect(isLockedCell(roleOf(roles, 'director'), logView)).toBe(false);
	});
});

/**
 * 最该被守住的一条：受保护的格子**不可能**出现在请求体里。
 *
 * 「界面上点不到」只是第一层。这一组刻意把受保护的项塞进草稿，模拟全选按钮、
 * 脚本注入、将来新增的批量操作——凡是绕过了 UI 那一层的路径，都必须在这里
 * 被挡住。漏掉的后果不是「多传了一项」，而是后端整次拒绝
 * （ApplyRolePermissions 全有或全无），于是这次无关的改动会把用户同一批里
 * 所有合法的改动一起吞掉。
 */
describe('submittablePermissions', () => {
	it('草稿里混进受保护的权限也传不上去', () => {
		const { permissions, roles } = matrix();
		const admin = roleOf(roles, 'admin');
		const tampered = [...admin.grants, 'system.maintain'];

		const submitted = submittablePermissions(admin, permissions, tampered);
		expect(submitted).not.toContain('system.maintain');
		// 与「没被篡改过」的草稿产出完全一致：多出来的那一项被静默剔除。
		expect(submitted).toEqual(submittablePermissions(admin, permissions, admin.grants));
	});

	it('受保护角色（超级管理员）整行都传不上去，全选也传不出任何东西', () => {
		const { permissions, roles } = matrix();
		const superAdmin = roleOf(roles, 'super_admin');
		const everything = permissions.map((perm) => perm.name);

		expect(everything.length).toBeGreaterThan(0);
		expect(submittablePermissions(superAdmin, permissions, everything)).toEqual([]);
	});

	it('只看 columns 里出现过的权限名：草稿里的陌生字符串不会被提交', () => {
		const { permissions, roles } = matrix();
		const director = roleOf(roles, 'director');
		const submitted = submittablePermissions(director, permissions, [
			...director.grants,
			'permission.i.made.up'
		]);
		expect(submitted).not.toContain('permission.i.made.up');
		expect(submitted).toEqual(director.grants);
	});

	it('输出按列顺序，与界面上从左到右一致', () => {
		const { permissions, roles } = matrix();
		const logistics = roleOf(roles, 'logistics');
		const submitted = submittablePermissions(logistics, permissions, ['project.view', 'log.view']);
		const columnOrder = permissions.map((p) => p.name);
		const positions = submitted.map((name) => columnOrder.indexOf(name));
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
		expect(submitted.length).toBe(2);
	});
});

/**
 * 草稿与已保存值必须是两个数组。
 *
 * 合成一个的话，「取消一个勾选」就等于在内存里悄悄改了已保存的策略：界面还
 * 显示着保存前的样子，点「取消」也回不去，于是出现「我什么都没干，权限变了」。
 */
describe('draftFrom', () => {
	it('返回副本，改草稿不会写回已保存的 grants', () => {
		const { roles } = matrix();
		const director = roleOf(roles, 'director');
		const draft = draftFrom(director);

		expect(draft).not.toBe(director.grants);
		expect(draft).toEqual(director.grants);

		draft.push('system.maintain');
		draft.splice(draft.indexOf('log.view'), 1);
		expect(director.grants).toContain('log.view');
		expect(director.grants).not.toContain('system.maintain');
	});

	it('重新进入编辑态时草稿回到已保存值（上一次的草稿不残留）', () => {
		const { roles } = matrix();
		const director = roleOf(roles, 'director');
		draftFrom(director).push('system.maintain');

		expect(draftFrom(director)).toEqual(director.grants);
	});

	it('草稿里混入受保护权限不算成一次改动', () => {
		const { permissions, roles } = matrix();
		const admin = roleOf(roles, 'admin');
		expect(pendingChange(admin, permissions, [...admin.grants, 'system.maintain'])).toEqual({
			granted: [],
			revoked: []
		});
	});
});

/**
 * 一项都没勾时提交的是空数组。
 *
 * 「清空一个角色的权限」是合法且必要的操作——多给一个角色一项能力很容易，
 * 收回来的那一项忘了收回才是事故。写成「空数组就不提交」的话，界面上会出现
 * 一个「全都不勾 = 保存 = 什么都没发生」的假象，而真正生效的策略里那一项
 * 还在。
 */
describe('清空权限是一次合法操作', () => {
	it('一项都没勾时提交 []，并且被认作一次真实的改动', () => {
		const { permissions, roles } = matrix();
		const packaging = roleOf(roles, 'packaging');
		expect(packaging.grants.length).toBeGreaterThan(0);

		expect(submittablePermissions(packaging, permissions, [])).toEqual([]);
		expect(pendingChange(packaging, permissions, [])).toEqual({
			granted: [],
			revoked: packaging.grants
		});
	});

	it('本来就一项权限都没有的角色，清空后不算改动', () => {
		const { permissions, roles } = matrix();
		const bare = roleOf(roles, 'logistics');
		const cleared: PolicyRoleView = { ...bare, grants: [] };

		expect(submittablePermissions(cleared, permissions, [])).toEqual([]);
		expect(pendingChange(cleared, permissions, [])).toEqual({ granted: [], revoked: [] });
	});
});

describe('diffGrants', () => {
	it('方向分开：新增与取消不能混成一个数组', () => {
		expect(diffGrants(['a', 'b'], ['b', 'c'])).toEqual({ granted: ['c'], revoked: ['a'] });
	});
});

describe('describeChange', () => {
	it('新增与取消都要点名，并带上中文名', () => {
		const text = describeChange(['log.export'], ['audit.view']);
		expect(text).toContain('log.export');
		expect(text).toContain('导出协调日志');
		expect(text).toContain('audit.view');
		expect(text).toContain('查看操作审计');
	});

	it('只增不撤、只撤不增都能读通', () => {
		expect(describeChange(['log.export'], [])).toContain('新增');
		expect(describeChange(['log.export'], [])).not.toContain('取消了');
		expect(describeChange([], ['audit.view'])).toContain('取消');
	});

	it('两边都空时明说「没有任何变化」', () => {
		expect(describeChange([], [])).toBe('没有任何变化');
	});
});

describe('sortedRoles', () => {
	it('按 level 从高到低，且不动调用点传进来的数组', () => {
		const { roles } = matrix();
		const before = roles.map((r) => r.value);
		const sorted = sortedRoles(roles);

		const levels = sorted.map((r) => r.level);
		expect(levels).toEqual([...levels].sort((a, b) => b - a));
		expect(sorted[0].value).toBe('super_admin');
		expect(roles.map((r) => r.value)).toEqual(before);
	});
});

/**
 * 五种 code 各有一个分支——少一个就等于那类失败落进兜底，而兜底把
 * 「刷新一下」和「你不能改」说成了同一句话。
 */
describe('policyFailure', () => {
	const detail = '后端给的中文说明';

	const cases: {
		code: string;
		kind: PolicyFailureKind;
		reload: boolean;
		keepDraft: boolean;
		/** 界面上那句话必须出现的东西——处置方式的可见证据。 */
		says: string;
	}[] = [
		{
			code: 'protected',
			kind: 'protected',
			reload: true,
			keepDraft: false,
			says: '受保护'
		},
		{
			code: 'unknown_role',
			kind: 'stale_role',
			reload: true,
			keepDraft: false,
			says: '刷新页面'
		},
		{
			code: 'unknown_permission',
			kind: 'stale_permission',
			reload: true,
			keepDraft: false,
			says: '刷新页面'
		},
		{
			code: 'policy_conflict',
			kind: 'conflict',
			reload: true,
			keepDraft: true,
			says: '本次没有生效'
		},
		{
			code: 'policy_unavailable',
			kind: 'unavailable',
			reload: true,
			keepDraft: true,
			says: '稍后重试'
		}
	];

	for (const item of cases) {
		it(`${item.code} → ${item.kind}（reload=${item.reload} keepDraft=${item.keepDraft}）`, () => {
			const failure = policyFailure(item.code, detail);

			expect(failure.kind).toBe(item.kind);
			expect(failure.reload).toBe(item.reload);
			expect(failure.keepDraft).toBe(item.keepDraft);
			expect(failure.code).toBe(item.code);
			// 后端的中文说明必须原样带出来，不能被界面的套话盖掉。
			expect(failure.message).toContain(detail);
			expect(failure.message).toContain(item.says);
		});
	}

	it('五种 code 落在五个互不相同的分支上', () => {
		const kinds = cases.map((item) => policyFailure(item.code, detail).kind);
		expect(new Set(kinds).size).toBe(cases.length);
	});

	it('「受保护不可改」与「你选的东西过期了」必须不是同一档', () => {
		// 这一组是本文件存在的理由：合成一句话的话，用户会刷新一百次也刷不出来。
		const protectedFailure = policyFailure('protected', detail);
		const staleFailure = policyFailure('unknown_role', detail);
		expect(protectedFailure.kind).not.toBe(staleFailure.kind);
		expect(protectedFailure.keepDraft).toBe(false);
		expect(staleFailure.message).toContain('刷新');
	});

	it('没带 code 的失败（断网 / 500）归 unknown：保留勾选，但不自动刷新', () => {
		const failure = policyFailure(undefined, '无法连接到服务器');
		expect(failure.kind).toBe('unknown');
		expect(failure.code).toBe('');
		expect(failure.reload).toBe(false);
		expect(failure.keepDraft).toBe(true);
		expect(failure.message).toContain('无法连接到服务器');
	});

	it('后端没给说明时也不出现「undefined」或半句话', () => {
		const failure = policyFailure('policy_conflict', '   ');
		expect(failure.message).not.toContain('undefined');
		expect(failure.message).toContain('本次没有生效');
	});
});
