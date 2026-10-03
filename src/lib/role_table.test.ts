import { describe, expect, it } from 'vitest';
import { ROLE_LABELS, ROLE_LEVELS, ROLES, type Role } from './api/types';
import { PAGE_PERMISSIONS, canVisit, permissionFor } from './permissions';
import { PERMISSIONS } from './rbac';
import { POLICY_BY_ROLE } from './rbac.fixture';
import { roleLabel, roleShortLabel, roleState, roleAtLeast } from './roles';

/**
 * 这份测试的唯一职责：把前端这份**手工副本**钉在后端 role.go 的真实值上。
 *
 * 为什么需要它：角色等级仍在前端本地判（控制器层的「能否操作他人」与角色中文名
 * 都靠它），而后端 models.Role.Level() 不出 HTTP。于是等级表在前端被抄了一份，
 * 抄错了没有任何编译错误、没有运行时异常。
 *
 * ⚠️ 准入**不再**用等级表：路由准入已换成 app/rbac 的具名权限，页面门槛见
 *    本文件末尾那一节（与后端 policy.csv 对账，矩阵由 rbac.test.ts 钉住）。
 *
 * 已经真实发生过一次：后端把角色等级重排（director 10→30、logistics 20→10，
 * 并新增 packaging / commentator）之后，前端没跟着改，后果是
 *   - 后勤(20) 能看到导播级页面（等级 20 >= 导播的门槛 10）；
 *   - 包装/解说这两个新角色前端根本不认识，roleAtLeast 一律按等级 0 处理，
 *     于是这两个账号登录后台后除了「登录即可」的页面全被过滤掉，
 *     现场看着像「按权限显示菜单没实装」。
 *
 * 改后端 role.go 的 level* 常量或新增角色时，这个文件会先响。
 */

/** 后端 app/models/role.go 的 level* 常量，逐个抄过来。 */
const BACKEND_LEVELS: Record<string, number> = {
	super_admin: 60,
	admin: 50,
	leader: 40,
	director: 30,
	packaging: 25,
	commentator: 20,
	pre_production: 20,
	logistics: 10
};

/** 后端 roleLabels。 */
const BACKEND_LABELS: Record<string, string> = {
	super_admin: '超级管理员',
	admin: '管理员',
	leader: '负责人',
	director: '导播',
	packaging: '包装',
	commentator: '解说',
	pre_production: '前期',
	logistics: '后勤'
};

describe('前端角色表与后端 role.go 一致', () => {
	it('等级数值逐个相同，且不多不少', () => {
		// 两个方向都要比：漏一个角色（后端加了、前端没加）会让那个角色登录后
		// 所有带门槛的页面都不显示；多一个（前端加了、后端没有）会让这个角色
		// 永远无法登录后端，却能在用户列表里被分配出去。
		expect({ ...ROLE_LEVELS }).toEqual(BACKEND_LEVELS);
	});

	it('中文名逐个相同', () => {
		expect({ ...ROLE_LABELS }).toEqual(BACKEND_LABELS);
	});

	it('ROLES 与等级表是同一组角色，没有多也没有少', () => {
		expect([...ROLES].sort()).toEqual(Object.keys(ROLE_LEVELS).sort());
	});

	it('ROLES 的排列顺序就是权限从高到低', () => {
		// 这份数组同时承担「列表展示顺序」，若顺序与等级不一致，界面上会出现
		// 「排在前面的人权限反而更低」这种看起来像 bug 的排序。
		const levels = ROLES.map((r) => ROLE_LEVELS[r]);
		for (let i = 1; i < levels.length; i++) {
			expect(levels[i]).toBeLessThanOrEqual(levels[i - 1]);
		}
	});

	it('业务要求的顺序：超管>管理>负责人>导播>=包装>解说=前期>后勤', () => {
		const l = (r: Role) => ROLE_LEVELS[r];
		expect(l('super_admin')).toBeGreaterThan(l('admin'));
		expect(l('admin')).toBeGreaterThan(l('leader'));
		expect(l('leader')).toBeGreaterThan(l('director'));
		// 「导播 >= 包装」：包装端要在设置里切换项目、读写本地配置，
		// 权限面比解说端略宽，所以比解说高、但不高于导播。
		expect(l('director')).toBeGreaterThanOrEqual(l('packaging'));
		expect(l('packaging')).toBeGreaterThan(l('commentator'));
		expect(l('commentator')).toBe(l('pre_production'));
		expect(l('pre_production')).toBeGreaterThan(l('logistics'));
	});

	it('解说与前期同级是有意的：两者权限面相同，只订阅与查看', () => {
		// 反过来也提醒：同级意味着 AtLeast 对两者互相成立，将来若解说端和前期
		// 真出现权限差异，必须把它们拆成两个等级，否则那条差异会被静悄悄放过。
		expect(roleAtLeast('commentator', 'pre_production')).toBe(true);
		expect(roleAtLeast('pre_production', 'commentator')).toBe(true);
	});
});

describe('角色展示辅助覆盖全部角色', () => {
	it('roleLabel / roleShortLabel / roleState 都认得每个角色', () => {
		// 这三个函数在角色缺失时会静默回退（返回原值或 neutral），
		// 漏补一个的症状是「包装端账号在用户列表里显示成 packaging」这种脏输出。
		for (const role of ROLES) {
			expect(roleLabel(role)).not.toBe(role);
			expect(roleShortLabel(role)).not.toBe(role);
			// logistics 是唯一该用 neutral 的角色：它权限最低，
			// 刻意不给醒目的配色去吸引注意。其余角色漏配会一起落到 neutral，
			// 所以单独排除它再断言。
			if (role === 'logistics') continue;
			expect(roleState(role)).not.toBe('neutral');
		}
	});

	it('未知角色原样返回，便于发现脏数据', () => {
		// 与「认得每个角色」相反的方向也要钉住：不能因为补全表而顺手把
		// 未知角色美化掉，脏数据必须一眼看得出。
		expect(roleLabel('不存在的角色')).toBe('不存在的角色');
		expect(roleAtLeast('不存在的角色', 'logistics')).toBe(false);
	});
});

describe('页面门槛表引用的权限必须合法', () => {
	it('PAGE_PERMISSIONS 里每个 perm 都是已声明的权限', () => {
		// perm 拼错的后果最阴：hasPermission 遇到未声明的权限名一律返回 false
		// （与后端 rbac.Can 的「权限名未知 → 拒」一致），于是这道门槛变成
		// 「任何人都进不去」，页面凭空消失且不报错。
		for (const p of PAGE_PERMISSIONS) {
			if (p.perm === undefined) continue;
			expect(PERMISSIONS, `${p.path} 的门槛 ${p.perm} 不是已声明的权限`).toContain(p.perm);
		}
	});

	it('导播与后勤进不来任何带门槛的页面（日志除外：log.view 全员持有）', () => {
		// 业务基线：网页后台只有负责人及以上能进（后端 admin_min_role=leader），
		// 导播的工作在导播室的原生应用里完成，不进后台。唯一例外是 log.view
		// ——它在 policy.csv 里是全员持有，「只有部分人能看日志」这件事
		// 刻意被设计成永远不成立。
		for (const p of PAGE_PERMISSIONS) {
			if (p.perm === undefined) continue;
			const expected = p.perm === 'log.view';
			expect(canVisit(POLICY_BY_ROLE.director, p.path), `${p.path} 对导播`).toBe(expected);
			expect(canVisit(POLICY_BY_ROLE.logistics, p.path), `${p.path} 对后勤`).toBe(expected);
		}
		expect(canVisit(POLICY_BY_ROLE.director, '/users')).toBe(false);
		expect(canVisit(POLICY_BY_ROLE.logistics, '/users')).toBe(false);
	});

	it('用户页的门槛是 user.view：负责人能看，但不能改人', () => {
		// 这是权限迁移最直接的收益，也是前端此前算错的地方：负责人角色不是
		// admin，按等级判断他看不到用户列表——而 policy.csv 给了他 user.view。
		expect(permissionFor('/users')).toBe('user.view');
		expect(canVisit(POLICY_BY_ROLE.leader, '/users')).toBe(true);
		expect(canVisit(POLICY_BY_ROLE.leader, '/projects')).toBe(false);
	});

	it('系统维护类页面要 system.maintain，策略里只有超管一行', () => {
		// /system 与 /settings 会暴露可执行文件路径、宿主机磁盘用量，
		// 并且能替换服务自身并重启进程。
		expect(permissionFor('/system')).toBe('system.maintain');
		expect(permissionFor('/settings')).toBe('system.maintain');
		expect(canVisit(POLICY_BY_ROLE.super_admin, '/settings')).toBe(true);
		expect(canVisit(POLICY_BY_ROLE.admin, '/settings')).toBe(false);
	});

	it('协调日志对负责人开放', () => {
		// log.view 全员持有，所以对后台用户（负责人及以上）等于「登录即可」，
		// 与迁移前写死的 min=leader 等价——但换成权限名之后，「导播与后勤
		// 也能看」这件事在别的客户端上依然成立，不必再靠角色表维持。
		expect(permissionFor('/logs')).toBe('log.view');
		expect(canVisit(POLICY_BY_ROLE.leader, '/logs')).toBe(true);
		expect(canVisit(POLICY_BY_ROLE.director, '/logs')).toBe(true);
	});
});
