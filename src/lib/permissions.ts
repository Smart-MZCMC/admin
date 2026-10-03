/**
 * 页面门槛表。
 *
 * 为什么集中成一处：这个项目已经在「同一件事写两份」上踩过两次坑了——
 *  - 角色名写死成两份：AppShell、用户页、权限分配页各有一处
 *    `admin ? '管理员' : '导播'`，加超管时全部漏改，把超管显示成「导播」；
 *  - 权限门槛写死成两份：侧边栏藏掉入口 vs 路由守卫拦地址栏。
 * 分开写就一定会有某一处忘了，于是出现「菜单里没有、但地址栏能进」的页面。
 *
 * 门槛现在写成**权限名**而不是角色等级。后端把路由准入换成了 app/rbac 的具名
 * 权限，角色等级已经不再是准入依据（它只管「能否操作某个人」），照旧拿等级
 * 当门槛会两头不讨好：负责人拿得到 user.view 与 project.member 却因为角色不是
 * admin 而看不到入口；反过来他若看到了某个按钮，点了必然 403。
 *
 * 真正的判定始终在后端（middleware.RequirePermission），这里只是不给无意义的
 * 入口。所以即使这一层写错，最坏结果也只是「按钮多点一下换来一个 403」。
 */
import { base as appBase } from '$app/paths';
import { hasPermission, type Permission } from '$lib/rbac';

/** 页面级门槛。缺省表示「登录即可」。 */
export interface PagePermission {
	/** 归一化后的路径，如 '/users'。 */
	path: string;
	/** 访问该页面所需的具名权限。缺省表示登录即可。 */
	perm?: Permission;
}

/**
 * 页面门槛表。
 *
 * 与 AppShell 的侧边栏是同一份数据的两个视图：侧边栏据此决定显示哪些入口，
 * 路由守卫据此决定直接输地址时要不要拦。
 *
 * ⚠️ 两边共用这一个数组，不要在 AppShell 里再写第二份 `perm`。
 */
export const PAGE_PERMISSIONS: PagePermission[] = [
	{ path: '/', perm: undefined },
	// 看用户列表要 user.view。负责人持有它——他能授权项目成员，所以必须看得见
	// 被授权的人是谁；增删改角色另需 user.manage，两者在后端是两行。
	{ path: '/users', perm: 'user.view' },
	// 建/改/删项目是系统管理员的活。负责人管的是「人上哪个项目」，
	// 那是 /assign，不是这里。
	{ path: '/projects', perm: 'project.manage' },
	// 授权/回收项目成员。**这一行是权限迁移带来的行为变更**：迁移前是
	// 「管理员及以上」，现在负责人也能。
	{ path: '/assign', perm: 'project.member' },
	// 协调日志与操作审计：负责人都要看得到「谁做了什么」，这是值班时的依据，
	// 不是管理动作。用 log.view 表达比写死 'leader' 更准确——log.view 全员持有，
	// 但网页后台本来只有负责人以上能进（后端 admin_min_role=leader），两者等价。
	{ path: '/logs', perm: 'log.view' },
	{ path: '/plugins', perm: undefined },
	// 运行指标（内存 / 磁盘 / 组件健康）会暴露可执行文件路径、工作目录和
	// 宿主机文件系统用量，属于「知道的人越少越好」的信息。
	// system.maintain 在后端策略里是唯一只有超管一行的权限。
	{ path: '/system', perm: 'system.maintain' },
	// 系统信息与在线更新会替换服务自身的可执行文件，与 /system 同级。
	{ path: '/settings', perm: 'system.maintain' },
	// 在线编辑 Casbin 策略矩阵。与系统维护同级，而且这个门槛就是那条
	// **不可撤销、且没人持有就没有任何界面能恢复**的 system.maintain——它既是
	// 改权限这个入口的钥匙，本身又是这套系统最后一道不可自解的锁。
	// 所以这一页必须共用这张表（而不是在 AppShell 里另写一份），否则会出现
	// 「菜单里没有、但地址栏能进」：一个连自己都保护不了的权限编辑器。
	{ path: '/rbac', perm: 'system.maintain' },
	// 个人中心按设计只挂在右上角的用户菜单里，任何登录用户都能进。
	{ path: '/profile', perm: undefined }
];

/**
 * 去掉部署基路径前缀，并把尾部斜杠归一。
 *
 * 为什么必须去：`svelte.config.js` 里 `paths.base = '/admin'`，所以生产环境下
 * `page.url.pathname` 拿到的是 `/admin/settings`，而上面这张表存的是 `/settings`。
 * 直接字符串比较永远匹配不上 → `permissionFor` 恒返回 undefined → 路由守卫形同
 * 虚设，任何登录用户直接输地址就能打开本该拦住的页面。侧边栏那层是好的，因为它
 * 传的是导航项自己的短路径 `/settings`——于是正好是本文件开头警告的
 * 「菜单里没有、但地址栏能进」。
 *
 * 它能长期存活是因为失效时页面照样渲染：数据请求被后端 403 挡掉，管理员看到的只是
 * 「页面报了个错」，不像「权限没拦住」，所以没人往门槛表上想。
 *
 * 边界检查用 `p === base || p.startsWith(base + '/')` 而不是裸 startsWith：
 * 否则 base 为 `/admin` 时，`/administrator` 会被砍成 `istrator`。
 */
export function stripBase(pathname: string, base: string): string {
	const trimmed = (pathname || '').replace(/\/+$/, '');
	if (!trimmed) return '/';
	if (!base || base === '/') return trimmed;
	if (trimmed === base) return '/';
	if (trimmed.startsWith(`${base}/`)) {
		const rest = trimmed.slice(base.length).replace(/\/+$/, '');
		return rest || '/';
	}
	return trimmed;
}

/**
 * 路径所需的权限；返回 undefined 表示「登录即可」。
 *
 * `base` 默认取自 `$app/paths`，也就是构建配置里的 `paths.base`。**刻意不给它一个
 * 空字符串默认值**：那等于允许调用点不表态，而「忘了传 base」正是这个守卫失效的
 * 原因——生产环境下 pathname 带 `/admin` 前缀，门槛表不带，比较永远不成立，
 * `permissionFor` 恒返回 undefined，于是任何登录用户直接输地址就能打开本该拦住的
 * 页面，而侧边栏那层是好的（它传的是导航项自己的短路径）。
 *
 * 第二个参数仅供测试用来显式覆盖 base，不必在业务代码里传。
 */
export function permissionFor(path: string, base: string = appBase): Permission | undefined {
	const normalised = stripBase(path, base);
	return PAGE_PERMISSIONS.find((p) => p.path === normalised)?.perm;
}

/** 给定的权限清单够不够得着这个路径。 */
export function canVisit(
	granted: readonly string[] | null | undefined,
	path: string,
	base: string = appBase
): boolean {
	const perm = permissionFor(path, base);
	if (!perm) return true;
	return hasPermission(granted, perm);
}
