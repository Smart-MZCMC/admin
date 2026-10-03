import { describe, expect, it } from 'vitest';
import { PAGE_PERMISSIONS, canVisit, permissionFor } from './permissions';
import { PERMISSIONS } from './rbac';

/**
 * 这张表同时被侧边栏（决定显示哪些入口）与路由守卫（决定直接输地址时拦不拦）
 * 使用。两边对不上就会出现「菜单里没有、但地址栏能进」的页面，所以：
 *  1. 路径必须唯一且都归一化（带不带结尾斜杠都能查到）；
 *  2. 门槛必须是**已声明的权限名**——手滑写个 'user.managee' 会让这个页面对
 *     所有人关闭，而且界面上只会显示「权限不足」，没人想得到是拼写错了。
 *     后端 rbac.Can 对未知权限名也是一律拒绝，两边行为一致。
 */
describe('PAGE_PERMISSIONS', () => {
	it('路径不重复', () => {
		const paths = PAGE_PERMISSIONS.map((p) => p.path);
		expect(new Set(paths).size).toBe(paths.length);
	});

	it('门槛引用的权限名都真实存在', () => {
		for (const p of PAGE_PERMISSIONS) {
			if (p.perm === undefined) continue;
			expect(PERMISSIONS, `${p.path} 的门槛 ${p.perm} 不是已声明的权限`).toContain(p.perm);
		}
	});

	it('结尾斜杠不影响查找', () => {
		expect(permissionFor('/users/')).toBe(permissionFor('/users'));
		expect(permissionFor('/users')).toBe('user.view');
		expect(permissionFor('')).toBe(permissionFor('/'));
	});
});

describe('permissionFor 的门槛与后端策略一致', () => {
	it('用户页按 user.view、不是按角色', () => {
		// 这一行是权限迁移的起因：负责人拿得到 user.view，角色却不是 admin，
		// 照旧按等级写门槛的话他会看不到用户列表——而他明明有权看。
		expect(permissionFor('/users')).toBe('user.view');
	});

	it('成员授权按 project.member（负责人及以上），项目管理按 project.manage', () => {
		expect(permissionFor('/assign')).toBe('project.member');
		expect(permissionFor('/projects')).toBe('project.manage');
	});

	it('系统维护类页面要 system.maintain（策略里只有超管一行）', () => {
		expect(permissionFor('/system')).toBe('system.maintain');
		expect(permissionFor('/settings')).toBe('system.maintain');
	});

	it('日志页按 log.view，不是写死 leader', () => {
		// log.view 全员持有，但网页后台本来只有负责人以上能进
		// （后端 admin_min_role=leader），两者对后台用户等价。用权限名表达
		// 更准确：以后放开后台门槛时这里不必再改。
		expect(permissionFor('/logs')).toBe('log.view');
	});

	it('登录即可的页面不设门槛', () => {
		expect(permissionFor('/')).toBeUndefined();
		expect(permissionFor('/plugins')).toBeUndefined();
		expect(permissionFor('/profile')).toBeUndefined();
	});
});

/**
 * 三个角色在网页后台里实际拿得到的页面。
 *
 * 网页后台只有负责人及以上能进（后端 admin_min_role=leader），所以导播/包装/
 * 解说/前期/后勤根本进不来这张表，实际用得到的只有这三列。
 */
const LEADER = [
	'log.view',
	'project.view',
	'user.view',
	'log.export',
	'interview.manage',
	'project.member'
];
const ADMIN = [
	...LEADER,
	'audit.view',
	'switch.operate',
	'log.cleanup',
	'project.manage',
	'user.manage'
];
const SUPER_ADMIN = [...ADMIN, 'system.maintain'];

describe('canVisit', () => {
	it('没设门槛的页面登录即可', () => {
		expect(permissionFor('/profile')).toBeUndefined();
		expect(canVisit([], '/profile')).toBe(true);
	});

	it('负责人看得到用户页与授权页（user.view / project.member）', () => {
		expect(canVisit(LEADER, '/users')).toBe(true);
		expect(canVisit(LEADER, '/assign')).toBe(true);
		expect(canVisit(LEADER, '/logs')).toBe(true);
	});

	it('负责人看不到项目管理与系统维护', () => {
		expect(canVisit(LEADER, '/projects')).toBe(false);
		expect(canVisit(LEADER, '/system')).toBe(false);
		expect(canVisit(LEADER, '/settings')).toBe(false);
	});

	it('管理员与超管依次递进', () => {
		expect(canVisit(ADMIN, '/projects')).toBe(true);
		expect(canVisit(ADMIN, '/system')).toBe(false);
		expect(canVisit(SUPER_ADMIN, '/system')).toBe(true);
		expect(canVisit(SUPER_ADMIN, '/settings')).toBe(true);
	});

	it('未登录 / 权限还没拉到时一律不可访问需要门槛的页面', () => {
		// 空数组是「登录态还没恢复」与「令牌刚失效」两种时刻的共同形态，
		// 必须一律拒绝，否则会闪出一屏本不该出现的入口。
		expect(canVisit(undefined, '/users')).toBe(false);
		expect(canVisit([], '/settings')).toBe(false);
	});

	it('未知路径不设门槛（登录即可，由页面自己处理 404）', () => {
		expect(permissionFor('/nowhere')).toBeUndefined();
	});
});
