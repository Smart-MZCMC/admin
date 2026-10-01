/**
 * Shared API types, mirroring backend/app/models and the JSON the controllers emit.
 */

/**
 * 与后端 app/models/role.go 的 models.Role 一一对应，按权限从高到低。
 *
 * 顺序有意义：它同时表达了等级高低（后端按等级判权限），
 * 所以「超级管理员 → 导播」既是最强到最弱，也是列表展示顺序。
 */
export const ROLES = [
	'super_admin',
	'admin',
	'leader',
	'pre_production',
	'logistics',
	'director'
] as const;

export type Role = (typeof ROLES)[number];

/** 与后端 models.Role 的 Level() 对齐，仅供前端本地判断等级。 */
export const ROLE_LEVELS: Record<Role, number> = {
	super_admin: 60,
	admin: 50,
	leader: 40,
	pre_production: 30,
	logistics: 20,
	director: 10
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
	pre_production: '前期',
	logistics: '后勤',
	director: '导播'
};

/** 把角色翻成中文的兜底表与本地等级判断在 $lib/roles 里，这里只放数据。 */

/** GET /api/roles */
export interface RoleInfo {
	value: Role;
	label: string;
	level: number;
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
	total: number;
	messages: Message[];
}

/** GET /api/status */
export interface ServerStatus {
	status: string;
	online_count: number;
	version: string;
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
	timestamp: string;
}

/** POST /api/logs/export and /api/logs/export/csv both report a row count back. */
export interface ExportResult {
	count: number;
	message?: string;
}

/** POST /api/logs/cleanup */
export interface CleanupResult {
	message: string;
	count: number;
}
