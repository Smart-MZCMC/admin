# 管理后台（admin）

校园直播导播协调系统的 Web 管理端，用 SvelteKit 5 + Tailwind CSS 4 + STDF 重写了原先单文件版
`backend/public/admin/index.html`（原生 JS + 内联 CSS）的全部功能，并补上了后端已有但旧后台没做的
日志与插件页面。

## 功能

| 路由 | 功能 |
| :--- | :--- |
| `/admin/login` | 用户名密码登录，JWT 存 localStorage，刷新后自动校验 `/api/auth/profile` |
| `/admin/users` | 用户列表、新建用户、切换角色（管理员/导播）、删除用户 |
| `/admin/projects` | 项目列表、新建/编辑/删除项目、点击复制项目编码 |
| `/admin/assign` | 给用户分配项目、撤销授权、查看全部授权记录 |
| `/admin/logs` | 按项目/类型/条数筛选历史消息，导出 JSON，导出 CSV，清理过期日志 |
| `/admin/plugins` | 已注册插件列表 + 每个项目的消息量、采访点数、控制权占用 |

顶部导航显示当前用户、角色、WebSocket 在线连接数（每 15 秒刷新）。

## 技术栈

- **SvelteKit 2 / Svelte 5**（runes：`$state`、`$derived`、`$effect`、`$props`、snippets）
- **Tailwind CSS 4**（`@tailwindcss/vite`，`@theme` 令牌 + `.dark` 变体）
- **STDF 1.2.0**（`Button`/`Input`/`Loading`/`Toast`）
- **adapter-static**，`base = '/admin'`，SPA fallback

### 关于 STDF 版本

项目安装的是 `stdf@1.2.0`，它比 `.dsh/skills/stdf` 里那份离线文档快照要旧，差异如下：

| 文档（新） | 实际 1.2.0 |
| :--- | :--- |
| `@import 'stdf/source.css'` | 不存在，改用 `@source '../node_modules/stdf/dist'` |
| `@plugin "stdf/theme"` | 不存在，主题令牌直接写在 `src/app.css` 的 `@theme` 里 |
| `data-mode="dark"` | 用 `.dark` 类（`stdf/theme` 的 `darkMode()`） |
| `Alert`、`Tag` 组件 | 未导出；Toast 走 `Toast`，标签用本地 `src/lib/components/Tag.svelte` |

`src/app.css` 中的 `@custom-variant dark` 同时匹配 `.dark` 和 `[data-mode=dark]`，因此将来升级
STDF 也不会立刻失效。

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

## 后端已知问题（前端已规避或已标注）

1. **`/api/logs/export/csv` 没有注册路由。** `app/plugins/handlers.go` 里的
   `ExportLogsCSVHandler` 从未在 `routes/web.go` 中注册，前端调不到。因此日志页的「导出 CSV」
   改为在前端把当前筛选结果拼成 CSV 并加 UTF-8 BOM 下载。
2. **管理接口没有角色校验。** `middleware.Jwt()` 只验签，不检查 `role`，任何登录用户都能调用
   `/api/admin/*`。前端只在界面上按角色隐藏按钮，这挡不住直接调接口。建议在后端加一个
   admin 中间件。
3. **`UpdateProject` 会忽略空描述。** 控制器只在 `description != ""` 时写入，所以编辑时清空描述
   不会被保存。编辑弹窗在这种情况下会给出提示。
