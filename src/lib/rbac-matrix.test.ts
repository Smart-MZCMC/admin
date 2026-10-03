import { describe, expect, it } from 'vitest';
import {
	describeChange,
	diffGrants,
	draftFrom,
	isLockedCell,
	normalisePolicyView,
	normaliseRolePermissions,
	pendingChange,
	policyFailure,
	sortedRoles,
	submittablePermissions,
	toNameList,
	type PolicyFailureKind
} from './rbac-matrix';
import {
	ROLES,
	ROLE_LABELS,
	ROLE_LEVELS,
	type PolicyPermissionView,
	type PolicyRoleView,
	type PolicyView,
	type RolePermissionsResult
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

	/**
	 * 绕开 UI、直接把整张矩阵当草稿塞进去的那条路。
	 *
	 * 前两条用例是「往草稿里塞一项」，这一条是「把界面能做的事做到极端」：把
	 * **每一列**都勾上（含受保护的那一列），并且从一个脏数据角色出发（它的
	 * grants 里真的挂着一项受保护权限——库里被手改过就会出现，而界面照实显示）。
	 *
	 * 这里断言的是「一个受保护的名字都不许出现在请求体里」，而不是「结果等于
	 * 某个数组」：后者在实现退化成只过滤已知项时也可能照样通过。
	 */
	it('把整张矩阵塞进草稿也一个受保护的项都传不出去', () => {
		const { permissions, roles } = matrix();
		const dirty = roleOf(roles, 'logistics');
		const dirtyRole: PolicyRoleView = { ...dirty, grants: [...dirty.grants, 'system.maintain'] };
		const everything = [...permissions.map((perm) => perm.name), 'system.maintain'];

		const submitted = submittablePermissions(dirtyRole, permissions, everything);
		expect(submitted).not.toContain('system.maintain');
		// 受保护的项不在基线里，所以也不该被算成「本次要撤销它」。
		const change = pendingChange(dirtyRole, permissions, everything);
		expect(change.revoked).toEqual([]);
		expect(change.granted).not.toContain('system.maintain');
		// 每一项可改的都确实提交了——防的是「过滤过头变成空数组」这种反向错误。
		expect(submitted).toEqual(
			permissions.filter((perm) => !perm.protected).map((perm) => perm.name)
		);
		expect(submitted.length).toBe(permissions.length - 1);
	});

	it('归一后的响应里受保护的项照样进不了提交集合（边界与数据层串起来）', () => {
		const { permissions, roles } = matrix();
		// 走一遍真实形状：先归一后端响应，再从里面挑出角色来提交。
		const view = normalisePolicyView({ ...matrix(), source: 'database', warnings: [] });
		const normalisedAdmin = view.roles.find((r) => r.value === 'admin');
		if (!normalisedAdmin) throw new Error('归一之后不该丢掉任何角色');

		const submitted = submittablePermissions(normalisedAdmin, view.permissions, [
			...normalisedAdmin.grants,
			'system.maintain'
		]);
		expect(submitted).not.toContain('system.maintain');
		expect(submitted).toEqual(roleOf(roles, 'admin').grants);
		expect(permissions.length).toBeGreaterThan(0);
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

	it('没带 code 的失败（断网 / 500 / 网关 HTML）归 unknown：保留勾选，但不自动刷新', () => {
		const failure = policyFailure(undefined, '无法连接到服务器');
		expect(failure.kind).toBe('unknown');
		expect(failure.code).toBe('');
		expect(failure.reload).toBe(false);
		expect(failure.keepDraft).toBe(true);
		expect(failure.message).toContain('无法连接到服务器');
	});

	/**
	 * 非 JSON 的响应体必须给出一句能照着做的话。
	 *
	 * 后端进程挂掉时 fetch 会直接 reject（走「无法连接到服务器」），而网关 502
	 * 返回的是 HTML、`ApiError.message` 只会是「请求失败 (HTTP 502)」。这时候
	 * 界面若只把这句话原样弹出来，用户无法判断刚才的勾选还算不算数——多半会
	 * 去刷新页面把半小时的选择填一遍。所以这一档必须明说「选择已保留」。
	 */
	it('响应体不是 JSON 时也说清「勾的内容还在」，而不是只丢一个 HTTP 状态码', () => {
		const html = policyFailure('', '请求失败 (HTTP 502)');
		expect(html.message).not.toContain('undefined');
		expect(html.message).not.toContain('null');
		expect(html.message).toContain('HTTP 502');
		expect(html.message).toContain('已保留');
		expect(html.reload).toBe(false);
		expect(html.keepDraft).toBe(true);

		const emptyBody = policyFailure('', '请求失败 (HTTP 500)');
		expect(emptyBody.message).toContain('已保留');
		expect(emptyBody.message).toContain('再点一次保存');
	});

	it('后端没给说明时也不出现「undefined」或半句话', () => {
		const failure = policyFailure('policy_conflict', '   ');
		expect(failure.message).not.toContain('undefined');
		expect(failure.message).toContain('本次没有生效');
	});
});

/**
 * 响应归一：Go 把 nil 切片序列化成 `null` 这件事，害得整页在保存成功的同一刻崩掉。
 *
 * 这组用例直接照抄后端**真实发出过**的响应体（实测记录）：
 *
 *	{"granted":null,"revoked":["log.view", …],"role":"director",
 *	 "source":"database","warnings":[…]}
 *
 * 只要 granted 是 null，`describeChange` 里的 `granted.length` 就抛 TypeError，
 * 而它在渲染/回调路径上——于是用户看到的是「报错了」，实际发生的是「已经生效了」。
 */
describe('normaliseRolePermissions', () => {
	const wire: RolePermissionsResult = {
		role: 'director',
		granted: null as unknown as string[],
		revoked: ['log.view', 'project.view'],
		source: 'database',
		warnings: null as unknown as string[]
	};

	it('granted 为 null（本次没有新增）时归一成空数组，不抛异常', () => {
		const result = normaliseRolePermissions(wire);
		expect(result.granted).toEqual([]);
		expect(() => describeChange(result.granted, result.revoked)).not.toThrow();
		expect(describeChange(result.granted, result.revoked)).toContain('取消了');
	});

	it('revoked 为 null（本次没有取消）时归一成空数组', () => {
		const result = normaliseRolePermissions({
			...wire,
			granted: ['log.export'],
			revoked: null as unknown as string[]
		});
		expect(result.revoked).toEqual([]);
		expect(describeChange(result.granted, result.revoked)).toContain('新增了');
	});

	it('两个方向都空时说的是「没有任何变化」，不是 undefined', () => {
		const result = normaliseRolePermissions({
			...wire,
			granted: null as unknown as string[],
			revoked: null as unknown as string[]
		});
		expect(describeChange(result.granted, result.revoked)).toBe('没有任何变化');
	});

	it('warnings 为 null 也归一成空数组（页面上要读它的 length）', () => {
		expect(normaliseRolePermissions(wire).warnings).toEqual([]);
	});

	it('非字符串元素被丢掉，不会变成界面上的 undefined', () => {
		const result = normaliseRolePermissions({
			...wire,
			granted: ['log.export', 42, null, undefined] as unknown as string[]
		});
		expect(result.granted).toEqual(['log.export']);
	});
});

describe('toNameList', () => {
	it('非数组一律给空数组（缺字段、null、对象都不该让页面崩）', () => {
		expect(toNameList(undefined)).toEqual([]);
		expect(toNameList(null)).toEqual([]);
		expect(toNameList('log.view')).toEqual([]);
		expect(toNameList({ 0: 'log.view' })).toEqual([]);
	});

	it('返回的是新数组，往里 push 不会污染原始响应', () => {
		const source = ['log.view'];
		const out = toNameList(source);
		out.push('project.view');
		expect(source).toEqual(['log.view']);
	});
});

describe('normalisePolicyView', () => {
	/** 真实响应形状，但把三个列表字段换成 null（Go 的 nil 切片）。 */
	const wire = {
		source: 'database',
		warnings: null as unknown as string[],
		permissions: [
			{
				name: 'system.maintain',
				label: '维护',
				protected: true,
				holders: null as unknown as string[]
			}
		],
		roles: [
			{
				value: 'logistics' as const,
				label: '后勤',
				level: 10,
				protected: false,
				grants: null as unknown as string[]
			}
		]
	} as unknown as PolicyView;

	it('grants 为 null 的角色照样能渲染（把权限清空就是这种形状）', () => {
		const view = normalisePolicyView(wire);
		const logistics = view.roles[0];
		expect(logistics.grants).toEqual([]);
		// 界面上就是这一行在读 grants.includes
		expect(logistics.grants.includes('log.view')).toBe(false);
	});

	it('holders 与 warnings 为 null 时归一成空数组', () => {
		const view = normalisePolicyView(wire);
		expect(view.permissions[0].holders).toEqual([]);
		expect(view.warnings).toEqual([]);
		expect(view.warnings.length).toBe(0);
	});

	it('受保护的标记原样保留：归一不得放宽任何一格', () => {
		const view = normalisePolicyView(wire);
		const perm = view.permissions[0];
		const logistics = view.roles[0];
		expect(perm.protected).toBe(true);
		expect(isLockedCell(logistics, perm)).toBe(true);
		expect(submittablePermissions(logistics, view.permissions, ['system.maintain'])).toEqual([]);
	});

	it('source 缺失时按「不是数据库」处理（embedded），宁可多提醒', () => {
		const view = normalisePolicyView({ ...wire, source: undefined as unknown as string });
		expect(view.source).toBe('embedded');
		expect(view.source !== 'database').toBe(true);
	});

	it('正常响应原样通过，不丢角色也不丢列', () => {
		const view = normalisePolicyView({
			source: 'database',
			warnings: ['受保护权限 system.maintain：理由'],
			permissions: [
				{ name: 'log.view', label: '查看协调日志', protected: false, holders: ['logistics'] }
			],
			roles: [
				{
					value: 'logistics',
					label: '后勤',
					level: 10,
					protected: false,
					grants: ['log.view']
				}
			]
		});
		expect(view.roles).toHaveLength(1);
		expect(view.permissions).toHaveLength(1);
		expect(view.warnings).toEqual(['受保护权限 system.maintain：理由']);
		expect(view.roles[0].grants).toEqual(['log.view']);
		expect(view.permissions[0].holders).toEqual(['logistics']);
	});
});
