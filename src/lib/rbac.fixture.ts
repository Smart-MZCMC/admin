/**
 * 测试夹具：后端 app/rbac 的权限词表与策略矩阵。
 *
 * **只给测试用，不要从产品代码 import。** 前端运行时永远不查策略，只问后端
 * 要自己那一份（GET /api/auth/permissions）——把整张矩阵打进产物里除了
 * 多几 KB 没有任何用处，还会让「这份副本过期了」这件事更难发现。
 *
 * 之所以要抄一份：权限矩阵的唯一事实来源是后端的 policy.csv，它不出 HTTP。
 * 抄错了没有任何编译错误、没有运行时异常，只是某个按钮该藏没藏、某个页面
 * 凭空消失。抄在这里、由 rbac.test.ts 钉住，是这个项目一贯的做法
 * （角色等级表的 role_table.test.ts 同理）。
 *
 * 文件名刻意不带 `.test.` ——vitest 的 include 是「src 下以 .test. / .spec. 结尾的
 * 文件」，带上了会被当成一个没有任何用例的测试文件。
 */

/** 后端 app/rbac/rbac.go 的 permissionNames，逐个抄过来。 */
export const BACKEND_PERMISSIONS = [
	'log.view',
	'project.view',
	'user.view',
	'audit.view',
	'log.export',
	'interview.manage',
	'project.member',
	'switch.operate',
	'log.cleanup',
	'project.manage',
	'user.manage',
	'system.maintain'
];

/** 后端 rbac.permissionLabels，逐个抄过来。 */
export const BACKEND_LABELS: Record<string, string> = {
	'log.view': '查看协调日志',
	'project.view': '查看项目列表、详情、机位、切台记录与统计',
	'user.view': '查看用户列表',
	'audit.view': '查看操作审计',
	'log.export': '导出协调日志',
	'interview.manage': '管理采访点',
	'project.member': '授权/回收项目成员',
	'switch.operate': '操作切台（获取/释放/续期控制权）',
	'log.cleanup': '清理协调日志',
	'project.manage': '创建/修改/删除项目与机位预设',
	'user.manage': '增删账号、调整角色',
	'system.maintain': '查看系统信息、运行指标与执行在线更新'
};

/**
 * 后端 app/rbac/policy.csv 里各角色实际持有的权限。
 *
 * 这是「迁移后谁该看到什么」的权威答案。改 policy.csv 时 rbac.test.ts 会先响。
 */
export const POLICY_BY_ROLE: Record<string, string[]> = {
	super_admin: [...BACKEND_PERMISSIONS],
	admin: [
		'log.view',
		'project.view',
		'user.view',
		'audit.view',
		'log.export',
		'interview.manage',
		'project.member',
		'switch.operate',
		'log.cleanup',
		'project.manage',
		'user.manage'
	],
	leader: [
		'log.view',
		'project.view',
		'user.view',
		'log.export',
		'interview.manage',
		'project.member'
	],
	director: ['log.view', 'project.view', 'switch.operate'],
	packaging: ['log.view', 'project.view'],
	commentator: ['log.view', 'project.view'],
	pre_production: ['log.view', 'project.view', 'interview.manage'],
	logistics: ['log.view', 'project.view']
};
