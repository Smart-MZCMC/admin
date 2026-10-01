# 管理后台（admin）

校园直播导播协调系统的 Web 管理端，用 SvelteKit 5 + Tailwind CSS 4 + STDF 重写了原先单文件版
`backend/public/admin/index.html`（原生 JS + 内联 CSS）的全部功能，并补上了后端已有但旧后台没做的
日志与插件页面。

## 功能

| 路由 | 功能 |
| :--- | :--- |
| `/admin/login` | 用户名密码登录，JWT 存 localStorage，刷新后自动校验 `/api/auth/profile` |
| `/admin/users` | 用户列表、新建用户、切换角色（下拉由 `/api/roles` 动态给出）、删除用户 |
| `/admin/projects` | 项目列表、新建/编辑/删除、日程与状态流转、机位预设编辑、切台报表 |
| `/admin/assign` | 给用户分配项目、撤销授权、查看全部授权记录 |
| `/admin/logs` | 「协调日志」与「操作审计」两个 Tab：前者按项目/类型/发件人/时间筛选消息、导出 JSON/CSV、清理过期日志；后者查操作审计记录 |
| `/admin/plugins` | 已注册插件列表（含真实启用状态与生效配置）+ 每个项目的消息量、采访点数、切台次数、控制权占用 |
| `/admin/settings` | 系统信息与在线更新（仅超级管理员） |
| `/admin/profile` | 个人中心：显示名、邮箱、改密码 |

### 「日志与审计」为什么有两个 Tab

数据来源是两张完全不同的表：

| Tab | 表 | 内容 |
| :--- | :--- | :--- |
| 协调日志 | `messages` | 谁切了台、谁发了内部消息、采访点状态变化 |
| 操作审计 | `audit_logs` | 谁改了别人的角色、谁删了账号、谁清了日志 |

这个页面以前叫「日志审计」但只显示前者，名字在骗人。拆开之后「谁把证据清了」
才查得到——`audit_logs` 之前根本不存在，审计只往 7 天轮转的 stdout 打。

导出接口的 `from` / `to` 是**必填**的（后端不再允许对整个项目历史做无条件查询），
所以页面上默认填最近 7 天。CSV 导出仍然在浏览器端拼装并遵守当前筛选条件——
服务端那份文件没人读，只会在 `storage/exports` 里一直涨。

### 首个管理员账号

后台没有「注册」页。系统不预置账号，**用户表为空时第一个调
`POST /api/auth/register` 的人自动成为超级管理员**。在服务器上执行：

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123456","display_name":"系统管理员"}'
```

之后该接口收紧为仅管理员可用，「用户管理」页的「新建用户」走的就是它。
细节见 `backend/DEPLOY.md` 与 `docs/operation-manual.md` 的「系统初始化」。

### 会话过期

`src/lib/api/client.ts` 的 `request()` 统一处理 401：清掉 localStorage 里的
令牌并跳回 `/admin/login`。403 不做跳转——那是当前用户的真实权限状态，
不该把登录态踢掉。

> 之所以现在能可靠地区分「令牌无效」和「网络故障」，是因为后端会为未授权
> 返回带可读消息的 JSON 错误体。早期所有未授权响应都是 `400` + 空 body。


顶部导航显示当前用户、角色、WebSocket 在线连接数（每 15 秒刷新）。

## 技术栈

- **SvelteKit 2 / Svelte 5**（runes：`$state`、`$derived`、`$effect`、`$props`、snippets）
- **Tailwind CSS 4**（`@tailwindcss/vite`，`@theme` 语义令牌 + `prefers-color-scheme`）
- **STDF 1.2.0**（`Button`/`Input`/`Loading`/`Toast`）
- **adapter-static**，`base = '/admin'`，SPA fallback

## 明暗自适应

界面跟随系统的浅色/深色外观设置，**纯 CSS 实现**：`src/app.css` 在
`@media (prefers-color-scheme: dark)` 里重新声明同一批语义变量。没有 JS、没有 `localStorage`
偏好、首屏不闪，切系统主题即时生效。

因此**组件里只能写语义令牌，不要写死 `bg-white`、`text-slate-900` 这类固定色**：

| 用途 | 令牌 |
| :--- | :--- |
| 页面底色 | `bg-bg-base` |
| 卡片 / 面板 / 侧栏 | `bg-bg-surface` |
| 弹层（下拉、菜单、kbd） | `bg-bg-elevated` |
| 表头、页脚、内嵌块、输入框 | `bg-bg-overlay` |
| 行 / 按钮悬停 | `hover:bg-bg-hover` |
| 选中项（导航、搜索命中） | `bg-bg-highlight` |
| 正文 / 次要 / 弱化文字 | `text-fg` / `text-fg-muted` / `text-fg-faint` |
| 描边 | `border-border`，悬停 `border-border-strong` |
| 状态色 | `{primary,success,warning,error,info,neutral}` × `-soft`（底）/ `-ink`（字） |

透明度写法照常可用：`bg-bg-overlay/70`、`border-primary-ink/20`（Tailwind 走 `color-mix`，
自动取当前模式的值）。

`app.html` 里用两枚 `theme-color` + `media` 让浏览器工具栏也跟着变；`color-scheme: light dark`
让原生 `<select>`、滚动条、日期选择器等浏览器控件自动切换。

以下颜色是**有意固定**的：品牌渐变（`from-blue-500 to-indigo-600`）、登录页左侧品牌栏上的白色
半透明层、模态框遮罩（`bg-slate-900/35`）、状态圆点。它们在两种模式下都成立。

### 关于 STDF 版本

项目安装的是 `stdf@1.2.0`，它比 `.dsh/skills/stdf` 里那份离线文档快照要旧，差异如下：

| 文档（新） | 实际 1.2.0 |
| :--- | :--- |
| `@import 'stdf/source.css'` | 不存在，改用 `@source '../node_modules/stdf/dist'` |
| `@plugin "stdf/theme"` | 不存在，主题令牌直接写在 `src/app.css` 的 `@theme` 里 |
| `data-mode="dark"` | 只提供 `darkMode()` 切换 `.dark` 类，本项目未启用（见上） |
| `Alert`、`Tag` 组件 | 未导出；Toast 走 `Toast`，标签用本地 `src/lib/components/Tag.svelte` |

STDF 组件内部大量使用 `dark:` 前缀类。Tailwind 4 的 `dark` 变体默认就是
`@media (prefers-color-scheme: dark)`，与本项目的自适应策略天然一致，无需 `@custom-variant`。
但 `stdf/theme` 的 `darkMode()` 是切 `.dark` 类，对媒体查询变体无效，将来接入 STDF 组件时不要
依赖它。

其余组件（卡片、面板、表格、模态框、确认框）是本地组件：STDF 是移动端组件库，桌面端表格与
无障碍模态框用它反而更难贴合，所以只在表单控件与反馈组件上使用 STDF。

## 开发

```sh
pnpm install
pnpm dev          # http://localhost:5173/admin/
```

开发时前端与 Go 后端不同源，需要在 `admin/.env` 指定后端地址：

```
VITE_API_BASE=http://127.0.0.1:3000
```

## 构建与部署

一条命令完成「类型检查 → 构建 → 推送静态文件到后端 → 校验」：

```powershell
pnpm run build:deploy
```

等价于 `node scripts/build.mjs`。脚本会：

1. `pnpm install`（可用 `--no-install` 跳过）
2. `pnpm run check` 类型检查（可用 `--no-check` 跳过）
3. `pnpm run build` 构建（可用 `--skip-build` 复用已有产物）
4. 清空并重写 `backend/public/admin/`，然后校验 `index.html` 引用的每个
   `/admin/...` 资源在磁盘上真实存在，缺失就报错退出

其它入口：

| 命令 | 说明 |
| :--- | :--- |
| `pnpm run build:deploy` | 完整流程 |
| `pnpm run deploy:only` | 跳过构建，只推送已有的 `build/` |
| `build-admin.bat`（仓库根目录） | 双击即可发布，失败会 pause 保留信息 |
| `node scripts/build.mjs --backend <path>` | 推送到非默认目录（父级必须叫 `public`） |

单独构建（不推送）仍是 `pnpm run build`，产物在 `admin/build/`。

构建产物是带 `/admin` 前缀的静态文件，由 `backend/routes/web.go` 托管：

- `GET /admin`、`GET /admin/` → SPA 入口
- `GET /admin/{path...}` → 命中真实文件就返回（`_app/*.js|css` 等），否则回退到入口，
  由前端路由接管 `/admin/users`、`/admin/logs` 等地址

静态文件路径经过 `path.Clean` + `filepath.Abs` 前缀校验，且只返回真实存在的文件，
避免 `../` 逃逸出 `public/admin`。静态文件是每次请求实时读取的，所以重新发布后
**不需要重启后端**；只有 `web.go` 本身改动才需要重新 `go build`。

## 后端接口备忘

### `/api/projects` 与 `/api/admin/projects` 不是一回事

| 接口 | 权限 | 返回 |
| :--- | :--- | :--- |
| `/api/admin/projects` | JWT + **admin** | 全部项目，管理用 |
| `/api/projects` | JWT | 当前账号有权访问的项目，给导播端用 |

导播端曾经误用了前者，于是项目下拉框恒为空——导播调它一律 403。

### 项目字段的更新语义是「出现了就更新」

`PUT /api/admin/projects/:id` 靠**键是否存在**区分「清空」与「不动」，空串表示
清空。所以调用时不要用 falsy 判断省略字段，否则描述一旦设过就再也清不掉
（1.3.0 及更早就是这个行为，界面上还专门加了一句提示来迁就它）。

### 时间字段接受不带秒的写法

后端的日志筛选、导出与项目日程都接受 `<input type="datetime-local">` 提交的
`2026-05-20T09:30`。少了这个格式，界面上选完时间一查询就是 400
「时间格式不正确」，错误信息完全指不到真正的原因。

### 项目成员校验（`REQUIRE_PROJECT_MEMBERSHIP`）

默认关闭。开启后，带 `projectId` 的接口会校验调用者是不是该项目成员
（管理员及以上绕过）；关闭时只记日志不拦截。管理后台本身以管理员身份访问，
一般不受影响，但「系统设置」之外的角色进不来这一页。
