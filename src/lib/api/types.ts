/**
 * Shared API types, mirroring backend/app/models and the JSON the controllers emit.
 */

/**
 * 与后端 app/models/role.go 的 models.Role 一一对应，按权限从高到低。
 *
 * 顺序有意义：它同时表达了等级高低（后端按等级判权限），
 * 所以「超级管理员 → 后勤」既是最强到最弱，也是列表展示顺序。
 *
 * ⚠️ 这份表是后端 role.go 的**手工副本**，改后端等级时必须同步改这里，
 * 否则前端按等级判的菜单门槛会与后端实际准入对不上：症状是「菜单里没有、
 * 但地址栏能进」或者反过来。后端改完请跑一次 `pnpm test`，
 * role_levels 的用例就是钉这份表的。
 */
export const ROLES = [
	'super_admin',
	'admin',
	'leader',
	'director',
	'packaging',
	'commentator',
	'pre_production',
	'logistics'
] as const;

export type Role = (typeof ROLES)[number];

/**
 * 与后端 models.Role 的 Level() 对齐，仅供前端本地判断等级。
 *
 * 数字必须与 role.go 里的 level* 常量逐个相同。解说与前期同为 20 是有意的：
 * 两者权限面相同（都只订阅与查看），用等级区分不了也不需要区分。
 */
export const ROLE_LEVELS: Record<Role, number> = {
	super_admin: 60,
	admin: 50,
	leader: 40,
	director: 30,
	packaging: 25,
	commentator: 20,
	pre_production: 20,
	logistics: 10
};

/**
 * 中文角色名兜底表。
 *
 * 页面优先用后端给的 `role_label`（ListUsers）与 /api/roles 的 `label`——
 * 后端才是唯一事实来源，这份表只在接口没给时兜底。
 */
export const ROLE_LABELS: Record<Role, string> = {
	super_admin: '超级管理员',
	admin: '管理员',
	leader: '负责人',
	director: '导播',
	packaging: '包装',
	commentator: '解说',
	pre_production: '前期',
	logistics: '后勤'
};

/** 把角色翻成中文的兜底表与本地等级判断在 $lib/roles 里，这里只放数据。 */

/** GET /api/roles */
export interface RoleInfo {
	value: Role;
	label: string;
	level: number;
}

/**
 * GET /api/auth/permissions — 当前账号的生效权限。
 *
 * 门槛是「登录即可」，且**只返回调用者自己的**：不返回全量策略矩阵，因为那是
 * 管理界面将来的数据源，届时该另开一个需要 user.manage 的接口，不该让任何
 * 登录用户都能读到「谁有什么权限」这张表。
 *
 * permissions 是后端 app/rbac 的权限名（`<对象>.<动作>`），前端词表见
 * $lib/rbac 的 PERMISSIONS。
 */
export interface PermissionsResponse {
	role: Role;
	/** 后端算好的中文角色名，用于「权限不足」提示里的自我说明。 */
	role_label: string;
	permissions: string[];
}

export interface AuthUser {
	id: number;
	username: string;
	display_name: string;
	role: Role;
	/**
	 * 邮箱，同时是 WeAvatar 头像的取值依据。后端写入前已归一化为小写去空格，
	 * 前端不必再处理大小写。
	 */
	email: string;
	/**
	 * 头像地址，由后端算好（前端不能算 MD5：Web Crypto 只有 SHA 系列）。
	 *
	 * 空串表示未设置邮箱，前端据此回退到首字母圆圈，而不是去请求一个
	 * 无意义的 URL。
	 */
	avatar_url: string;
	/** 后端算好的中文角色名。 */
	role_label: string;
}

/** PUT /api/auth/password — 改密后旧令牌全部失效，故返回新令牌。 */
export interface ChangePasswordResponse {
	token: string;
	user: AuthUser;
}

export interface LoginResponse {
	token: string;
	user: AuthUser;
}

/** backend/app/models/user.go */
export interface User {
	id: number;
	username: string;
	display_name: string;
	role: Role;
	/**
	 * 后端算好的中文角色名。
	 *
	 * 之前每个页面各自写一份 role === 'admin' ? '管理员' : '导播'，
	 * 加超级管理员后全部会把超管显示成「导播」。
	 */
	role_label?: string;
	created_at?: string;
}

/** backend/app/models/project.go */
export interface Project {
	id: number;
	name: string;
	code: string;
	description: string;
	created_at?: string;
	/**
	 * 计划时间窗。nullable：没排期的项目与「排在零值时刻」必须区分开，
	 * 否则导播端按时间排序时未排期的会被顶到最前面。
	 */
	scheduled_start?: string | null;
	scheduled_end?: string | null;
	venue?: string;
	/** 项目负责人 users.id，0 表示未指定。 */
	owner_id?: number;
	status?: ProjectStatus;
	mode?: ProjectMode;
}

/** backend/app/models/user_project.go */
export interface UserProject {
	id: number;
	user_id: number;
	project_id: number;
}

/** backend/app/models/message.go */
export interface Message {
	id: number;
	project_id: number;
	sender_id: number;
	type: string;
	content: string;
	created_at: string;
	sender?: User;
}

/** GET /api/logs */
export interface LogsResponse {
	/**
	 * 匹配筛选条件的**真实总行数**，与本次返回的 messages 长度无关。
	 *
	 * 之前后端返回的是 `len(messages)`，也就是被 limit 截断后这一页的长度，
	 * 而总览页喂的是 listLogs({ limit: 8 })——于是「消息累计」恒定不超过 8。
	 */
	total: number;
	messages: Message[];
	/** 下一页的游标：本页最后一条的 ID。0 表示没有下一页。 */
	next_cursor: number;
	has_more: boolean;
}

/** 项目状态与模式，与后端 models/project.go 的常量一一对应。 */
export const PROJECT_STATUSES = ['planned', 'live', 'finished', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_MODES = ['live', 'rehearsal'] as const;
export type ProjectMode = (typeof PROJECT_MODES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
	planned: '已计划',
	live: '直播中',
	finished: '已结束',
	cancelled: '已取消'
};

export const PROJECT_MODE_LABELS: Record<ProjectMode, string> = {
	live: '正式直播',
	rehearsal: '彩排'
};

/** GET /api/projects/:projectId/cameras */
export interface ProjectCamera {
	id: number;
	project_id: number;
	name: string;
	sort_order: number;
}

/** GET /api/projects/:projectId/shot-cuts — 切台流水与报表 */
export interface ShotCut {
	id: number;
	project_id: number;
	from_shot: string;
	to_shot: string;
	director_id: number;
	mode: string;
	cut_at: string;
}

export interface ShotCutStat {
	shot: string;
	count: number;
	avg_dwell_seconds: number;
}

export interface ShotCutModeStat {
	mode: string;
	cut_count: number;
}

export interface ShotCutsResponse {
	project_id: number;
	total: number;
	cuts: ShotCut[];
	summary: {
		cut_count: number;
		avg_dwell_seconds: number;
		by_shot: ShotCutStat[];
		by_mode: ShotCutModeStat[];
	};
}

/**
 * GET /api/admin/audit-logs — 操作审计。
 *
 * 与 /api/logs（协调日志：谁切了台、谁发了内部消息）是两回事：这里记的是
 * 「谁改了别人的角色、谁清掉了日志」。audit_logs 之前根本不存在，
 * 审计只往 7 天轮转的 stdout 打，而且只覆盖三处操作。
 */
export interface AuditLog {
	id: number;
	actor_id: number;
	/** 已脱敏的用户名（首字符 + *** + 末字符）。 */
	actor_username: string;
	action: string;
	target_type: string;
	target_id: string;
	/** 一句话说明 + 附加 JSON。 */
	detail: string;
	ip: string;
	created_at: string;
}

export interface AuditLogsResponse {
	total: number;
	logs: AuditLog[];
	next_cursor: number;
	has_more: boolean;
	/** 库里出现过的动作类型，供筛选下拉使用。 */
	actions: string[];
}

/** GET /api/status */
export interface ServerStatus {
	status: string;
	online_count: number;
	version: string;
	/**
	 * 后端要求的最低客户端版本。低于它的客户端会提示「必须更新」。
	 *
	 * 可选：1.2.0 之前的后端没有这个字段。新版 admin 对上老后端时要能正常
	 * 降级（退回「版本不等就提醒」），不能当成读取 undefined 时崩掉。
	 */
	min_client_version?: string;
}

/**
 * GET /api/health
 *
 * 公开探针。status 为 unhealthy 时 HTTP 也是 503，所以前端要能读 body，
 * 不能只按 ok 判断（直接 fetch 而非走 request()）。
 */
export interface HealthStatus {
	status: 'ok' | 'unhealthy';
	version: string;
	uptime_seconds: number;
	checks: { database: boolean };
	/** 仅超级管理员可见：数据库错误详情。 */
	detail?: string | null;
}

/** GET /api/system/update — 仅超级管理员 */
export interface UpdateStatus {
	current_version: string;
	latest_version?: string;
	has_update: boolean;
	enabled: boolean;
	allow_replace: boolean;
	source: string;
	asset_name: string;
	published_at?: string;
	release_url?: string;
	size?: number;
	/** 连不上更新源等原因。不是 HTTP 错误，所以这里有值时请求仍是 200。 */
	error?: string;
	/** 资产下载镜像前缀；空表示直接从 GitHub 下载。 */
	download_mirror?: string;
	/**
	 * checksums.txt 的可信地址；空表示跟随下载源。
	 *
	 * 两者都空/都指向同一处时，校验值与安装包同源——sha256 就只是形式上的校验。
	 */
	checksum_url?: string;
}

/**
 * GET /api/system/update/progress — 在线更新的实时进度
 *
 * 更新跑在服务端后台，这里是它唯一的观察窗口。`stage=idle` 表示当前没有任务
 * 在跑（不是错误），`finished` 表示可以停止轮询了。
 */
export type UpdateStage =
	| 'idle'
	| 'fetching'
	| 'downloading'
	| 'verifying'
	| 'extracting'
	| 'replacing'
	| 'migrating'
	| 'finished'
	| 'failed';

export interface UpdateProgress {
	stage: UpdateStage;
	message?: string;
	/** 已下载/已处理字节数。下载阶段有值，其余阶段为 0。 */
	done: number;
	total: number;
	/** 0..100。total 未知（镜像没给 Content-Length）时为 0。 */
	percent: number;
	steps?: string[];
	/** 终态标志，为 true 时前端应停止轮询。 */
	finished: boolean;
	failed: boolean;
	error?: string;
	result?: {
		version: string;
		bytes: number;
		sha256: string;
		arch: string;
		staged: boolean;
		replaced: boolean;
		migrated: boolean;
		backup_path?: string;
		staged_path?: string;
		steps: string[];
		restart_hint?: string;
	};
	started_at: string;
	updated_at: string;
}

/** POST /api/system/update/apply — 仅超级管理员 */
export interface ApplyUpdateResult {
	version: string;
	bytes: number;
	sha256: string;
	arch: string;
	staged: boolean;
	replaced: boolean;
	migrated: boolean;
	backup_path?: string;
	staged_path?: string;
	steps: string[];
	restart_hint?: string;
}

/** GET /api/system/info — 仅超级管理员 */
export interface SystemInfo {
	version: string;
	runtime: {
		pid: number;
		go_version: string;
		platform: string;
		num_cpu: number;
		goroutines: number;
		executable: string;
		working_dir: string;
		uptime_seconds: number;
		online_count: number;
	};
	executable: string;
	updater: {
		enabled: boolean;
		allow_replace: boolean;
		repo: string;
		asset: string;
		server: string;
	};
	operated_by: { username: string; role: string; role_label: string };
}

/**
 * GET /api/system/metrics 的响应，仅超级管理员可见。
 *
 * 字节数一律由后端给「字节」，换算成 MB/GB 放在前端做。两边都换算会出现
 * 「后端算 1.05GB、界面显示 1GB」这类对不上的数字，查起来很费时间。
 */
export interface SystemMetrics {
	runtime: {
		version: string;
		go_version: string;
		platform: string;
		num_cpu: number;
		goroutines: number;
		pid: number;
		uptime_seconds: number;
		started_at: string;
		executable: string;
		working_dir: string;
		online_count: number;
	};
	memory: {
		alloc_bytes: number;
		total_alloc_bytes: number;
		sys_bytes: number;
		heap_alloc_bytes: number;
		heap_inuse_bytes: number;
		stack_inuse_bytes: number;
		num_gc: number;
		/** RFC3339；从未 GC 过时为空串。 */
		last_gc: string;
		gc_cpu_fraction: number;
	};
	disk: {
		path: string;
		/** 非 linux 平台拿不到文件系统用量，此时为 false，看 note。 */
		supported: boolean;
		total_bytes: number;
		free_bytes: number;
		used_bytes: number;
		used_percent: number;
		app_bytes: number;
		app_bytes_detail: { name: string; bytes: number; error?: string }[];
		note: string;
	};
	database: {
		driver: string;
		path: string;
		size_bytes: number;
		ping: {
			connected: boolean;
			version: string;
			latency_ms: number;
			error: string;
		};
	};
	components: {
		name: string;
		/** running / connected / degraded / error / disabled */
		status: string;
		version?: string;
		detail?: string;
	}[];
	collected_at: string;
}

/**
 * GET /api/plugins — plugins.List() returns a descriptor per plugin,
 * including its effective config and whether it is actually running.
 * Secrets (e.g. the ntfy topic) arrive already masked from the backend.
 */
export interface PluginInfo {
	name: string;
	version: string;
	description: string;
	enabled: boolean;
	/** Why the plugin is off. Absent when it is running. */
	reason?: string;
	/** Effective config, already redacted. */
	config: Record<string, string>;
}

/** GET /api/projects/:projectId/stats */
export interface ProjectStats {
	project_id: number;
	message_count: number;
	lock_active: boolean;
	lock_holder: number;
	interview_points: number;
	/** B1 之后才有：切台次数与平均停留时长。老后端不返回，故可选。 */
	shot_cut_count?: number;
	avg_shot_dwell_seconds?: number;
	timestamp: string;
}

/**
 * POST /api/logs/export 与 /api/logs/export/csv 都会回报导出行数。
 *
 * from/to 是必填的：后端不再允许对整个项目历史做一次无条件查询。
 * truncated 为 true 表示触到了行数上限，应提示用户缩小时间范围。
 */
export interface ExportResult {
	count: number;
	message?: string;
	from?: string;
	to?: string;
	truncated?: boolean;
	limit?: number;
}

/** POST /api/logs/cleanup */
export interface CleanupResult {
	message: string;
	count: number;
}

/**
 * GET /api/setup/status — 全新部署的初始化向导
 *
 * 做成判别联合而不是「所有字段 optional」，是因为后端只在 needs_setup 为 true
 * 时才下发部署细节（已初始化后整体停发，见 setup_controller.go 的 Status）。
 * 写成 optional 的话，模板里 `status.database.path` 会被静默允许，
 * 于是在已初始化的系统上渲染出一堆 undefined——那正是这次要堵的泄露，
 * 只不过从服务端搬到了前端。判别联合让 svelte-check 在每个使用点强制收窄。
 */
interface SetupStatusPending {
	/** 系统是否还没初始化。true 时除 /api/setup/* 外的接口都会返回 503。 */
	needs_setup: true;
	version: string;
	/** 探测到的内网 IP，可能为空（无可用网卡）。 */
	lan_ip: string;
	database: {
		connection: string;
		path: string;
		/** 当前是否存在。注意：框架打开连接时会顺手建出空文件，所以它很快会变成 true。 */
		exists: boolean;
		/** 进程启动时数据库文件不存在 —— 这才是「全新部署」的判据。 */
		missing_at_startup: boolean;
	};
	env: {
		path: string;
		abs_path: string;
		exists: boolean;
		/** false 时向导会在提交前就拒绝，避免白填一遍。 */
		writable: boolean;
	};
	secrets: {
		app_key: boolean;
		jwt_secret: boolean;
	};
	defaults: {
		app_name: string;
		app_url: string;
		app_host: string;
		app_port: string;
		admin_username: string;
		admin_display_name: string;
	};
}

/** 已初始化：后端只回这两个字段，部署细节一概不下发。 */
interface SetupStatusReady {
	needs_setup: false;
	version: string;
}

export type SetupStatus = SetupStatusPending | SetupStatusReady;

/** 收窄后的形态：只有「还没初始化」时部署细节才存在。模板里统一走这个变量。 */
export type SetupDetails = SetupStatusPending;

/** POST /api/setup/apply 的请求体 */
export interface SetupApplyPayload {
	app_name: string;
	app_url: string;
	app_host: string;
	app_port: string;
	admin_username: string;
	admin_password: string;
	admin_display_name?: string;
	admin_email?: string;
}

/** POST /api/setup/apply — 初始化结果 */
export interface SetupApplyResult {
	message: string;
	admin: AuthUser;
	/** 本次真正改动过的 .env 键名。 */
	env_written: string[];
	env_path: string;
	/** 监听地址/端口变了，需要重启后端才生效。 */
	restart_required: boolean;
	app_url: string;
	ws_url: string;
	login_url: string;
	notes: string[];
}
