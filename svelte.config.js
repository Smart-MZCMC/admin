import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// The Go backend serves this app from /admin as plain static files
		// (see backend/routes/web.go), so the build must be a static SPA that
		// references every asset through the /admin base path.
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: false
		}),
		paths: {
			base: '/admin',
			relative: false
		},
		// 每 30 秒比对一次构建版本，不一致就硬刷新。
		//
		// 为什么必须有：后台开了代码分割（当前 14 个路由级 chunk），而在线更新
		// 把 public/ **整份换掉、不留上一版残渣**。于是一个跨更新还开着的旧标签页，
		// 点到尚未加载过的路由时会去请求那个路由的 chunk，而那个文件名已从磁盘上
		// 消失 → 404 → 页面崩掉。
		//
		// 为什么是「有时候」崩：chunk 带内容哈希且发 immutable 缓存，所以**已经
		// 加载过**的路由能命中浏览器缓存，没事；**没加载过**的就是 404。同一个人、
		// 同一次更新，表现取决于他之前逛过哪些页面——看起来像随机故障。
		//
		// 不配这一项时 SvelteKit 只在客户端导航时看一眼版本，而我实测过：
		// 磁盘版本已经变了，纯客户端导航过去，页面并没有重载——所以那条路也堵不住。
		//
		// ⚠️ **单位是毫秒，不是秒。** 写 30 会编译成 setTimeout(check, 30)，
		// 实测每秒 21 次请求（每个打开的标签页每分钟 1296 个），足以把现场那台
		// 小机器打满。SvelteKit 的文档没把这个单位说清楚，配置里也没有类型提示。
		//
		// 30000 的权衡：太短则一次更新可能把正在填表单的人刷掉（硬刷新会丢输入），
		// 太长则旧代码要挂很久。而且更新会替换二进制并重启进程，期间所有请求本来
		// 就会失败，用户必然会察觉，所以「自己没被刷新」不是可接受的状态。
		version: {
			pollInterval: 30000
		},
		appDir: '_app',
		prerender: {
			// Only the shell is prerendered; every other route is served through
			// the SPA fallback so the Go server needs just one static handler.
			crawl: false,
			entries: ['/']
		}
	}
};

export default config;
