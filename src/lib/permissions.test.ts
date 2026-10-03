import { describe, expect, it } from 'vitest';
import { PAGE_PERMISSIONS, canVisit, permissionFor, stripBase } from './permissions';
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

describe('stripBase', () => {
	// 这条规则防的是「路由守卫静默失效」。生产环境 paths.base='/admin'，
	// page.url.pathname 拿到的是 '/admin/settings'，而门槛表存的是 '/settings'，
	// 不去掉前缀就永远匹配不上——守卫恒返回 undefined，任何登录用户直接输地址
	// 就能打开本该拦住的页面。它长期没被发现，是因为失效时页面照样渲染，
	// 只是数据请求被后端 403 挡掉，看起来像「页面有点问题」。

	it('去掉 base 前缀后与门槛表对得上', () => {
		expect(stripBase('/admin/settings', '/admin')).toBe('/settings');
		expect(stripBase('/admin/rbac', '/admin')).toBe('/rbac');
		expect(stripBase('/admin', '/admin')).toBe('/');
		expect(permissionFor('/admin/settings', '/admin')).toBe('system.maintain');
		expect(permissionFor('/admin/rbac', '/admin')).toBe('system.maintain');
	});

	it('尾部斜杠两种写法都归一到同一条目', () => {
		expect(stripBase('/admin/settings/', '/admin')).toBe('/settings');
		expect(stripBase('/admin/settings', '/admin')).toBe('/settings');
		expect(permissionFor('/admin/users/', '/admin')).toBe('user.view');
	});

	it('不带 base 时原样归一，短路径照旧可用', () => {
		expect(stripBase('/settings', '')).toBe('/settings');
		expect(permissionFor('/settings')).toBe('system.maintain');
		expect(permissionFor('/settings', '')).toBe('system.maintain');
	});

	it('边界检查：不能把 /administrator 砍成 istrator', () => {
		expect(stripBase('/administrator', '/admin')).toBe('/administrator');
		expect(stripBase('/adminfoo/settings', '/admin')).toBe('/adminfoo/settings');
		expect(permissionFor('/administrator', '/admin')).toBeUndefined();
	});

	it('base 为 / 或空时不做任何裁剪', () => {
		expect(stripBase('/settings', '/')).toBe('/settings');
		expect(stripBase('/settings', '')).toBe('/settings');
	});

	it('带 base 时守卫真的会拦住无权限账号', () => {
		// leader 持有 6 项权限，不含 system.maintain。
		const leader = [
			'log.view',
			'project.view',
			'user.view',
			'log.export',
			'interview.manage',
			'project.member'
		];
		expect(canVisit(leader, '/admin/settings', '/admin')).toBe(false);
		expect(canVisit(leader, '/admin/system', '/admin')).toBe(false);
		expect(canVisit(leader, '/admin/rbac', '/admin')).toBe(false);
	});

	it('默认值就是构建配置的 base，所以调用点不传也不会漏判', () => {
		// 这条是本次那个漏洞的回归见证：调用点不传 base 时曾经恒返回「无门槛」。
		// 现在 base 默认取自 $app/paths，业务代码里**不需要**传它；
		// 显式传 '' 等于手动关掉前缀处理，那是测试专用的手法。
		const leader = ['log.view', 'project.view', 'user.view'];
		expect(canVisit(leader, '/admin/settings')).toBe(false);
		expect(canVisit(leader, '/admin/settings', '')).toBe(true);
	});

	it('带 base 时有权限账号仍然进得去', () => {
		expect(canVisit(['system.maintain'], '/admin/settings', '/admin')).toBe(true);
		expect(canVisit(['user.view'], '/admin/users', '/admin')).toBe(true);
	});

	it('登录即可的页面在带 base 时不受影响', () => {
		expect(canVisit([], '/admin/profile', '/admin')).toBe(true);
		expect(canVisit([], '/admin/plugins', '/admin')).toBe(true);
	});
});
