/**
 * 页面与操作的权限表。
 *
 * 为什么集中成一处：这个项目已经在「角色名写死成两份」上踩过坑了——
 * AppShell、用户页、权限分配页各有一处 `admin ? '管理员' : '导播'`，
 * 加超级管理员时全部漏改，把超管显示成「导播」。权限门槛同理：
 * 侧边栏藏掉入口、直接敲 URL 进来、页面上把按钮藏掉，这三处必须说同一件事，
 * 分开写就一定会有某一处忘了，于是出现「菜单里没有、但地址栏能进」的页面。
 *
 * 真正的权限判定始终在后端（RequireRole 中间件），这里只是不给无意义的入口。
 * 所以即使这一层写错，最坏结果也只是「按钮多点一下换来一个 403」，
 * 不会出现越权。
 *
 * 角色等级语义与后端 models.Role 的 Level 一致（见 $lib/roles 的 roleAtLeast）。
 */
import { roleAtLeast } from '$lib/roles';
import type { Role } from '$lib/api/types';

/** 页面级门槛。缺省表示「登录即可」。 */
export interface PagePermission {
	/** 归一化后的路径，如 '/users'。 */
	path: string;
	/** 访问该页面所需的最低角色等级。 */
	min?: Role;
}

/**
 * 页面门槛表。
 *
 * 与 AppShell 的侧边栏是同一份数据的两个视图：侧边栏据此决定显示哪些入口，
 * 路由守卫据此决定直接输地址时要不要拦。
 *
 * ⚠️ 两边共用这一个数组，不要在 AppShell 里再写第二份 `min`。
 */
export const PAGE_PERMISSIONS: PagePermission[] = [
	{ path: '/', min: undefined },
	{ path: '/users', min: 'admin' },
	{ path: '/projects', min: 'admin' },
	{ path: '/assign', min: 'admin' },
	// 协调日志与操作审计：负责人都要看得到「谁做了什么」，
	// 这是值班时的依据，不是管理动作。
	{ path: '/logs', min: 'leader' },
	{ path: '/plugins', min: undefined },
	// 运行指标（内存 / 磁盘 / 组件健康）会暴露可执行文件路径、工作目录和
	// 宿主机文件系统用量，属于「知道的人越少越好」的信息，只给超管。
	{ path: '/system', min: 'super_admin' },
	// 系统信息与在线更新会替换服务自身的可执行文件，只给超管。
	{ path: '/settings', min: 'super_admin' },
	// 个人中心按设计只挂在右上角的用户菜单里，任何登录用户都能进。
	{ path: '/profile', min: undefined }
];

/** 路径的访问门槛；返回 undefined 表示「登录即可」。 */
export function minRoleFor(path: string): Role | undefined {
	const normalised = path.replace(/\/+$/, '') || '/';
	return PAGE_PERMISSIONS.find((p) => p.path === normalised)?.min;
}

/** 当前角色是否够得着这个路径。 */
export function canVisit(role: string | undefined, path: string): boolean {
	const min = minRoleFor(path);
	if (!min) return true;
	return roleAtLeast(role, min);
}
