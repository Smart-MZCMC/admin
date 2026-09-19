#!/usr/bin/env node
/**
 * Build the admin SPA and publish it into the Go backend's static directory.
 *
 *   node scripts/build.mjs                  # typecheck + build + deploy
 *   node scripts/build.mjs --no-install     # skip `pnpm install`
 *   node scripts/build.mjs --no-check       # skip `svelte-check`
 *   node scripts/build.mjs --skip-build     # deploy the existing build/ only
 *   node scripts/build.mjs --backend ../backend/public/admin
 *
 * Deployed output is the SvelteKit static build (base path `/admin`), which
 * `backend/routes/web.go` serves together with an SPA fallback.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, cpSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const adminDir = resolve(scriptDir, '..');
const buildDir = join(adminDir, 'build');
const defaultBackend = resolve(adminDir, '..', 'backend', 'public', 'admin');

// --- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
	const i = argv.indexOf(flag);
	return i >= 0 ? argv[i + 1] : undefined;
};

const backendDir = resolve(adminDir, valueOf('--backend') ?? defaultBackend);
const skipInstall = has('--no-install');
const skipCheck = has('--no-check');
const skipBuild = has('--skip-build');

// --- logging --------------------------------------------------------------
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const step = (msg) => console.log(paint('36;1', `\n==> ${msg}`));
const ok = (msg) => console.log(paint('32', `    ok  ${msg}`));
const warn = (msg) => console.log(paint('33', `    warn  ${msg}`));
const fail = (msg) => console.error(paint('31;1', `    fail  ${msg}`));

// A failed awaited child rejects at top level; report it without a raw stack.
process.on('unhandledRejection', (reason) => {
	fail(reason instanceof Error ? reason.message : String(reason));
	process.exit(1);
});

const run = (command, args, extraEnv) =>
	new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(
			// On Windows pnpm is a .cmd shim, so it needs the shell; passing the whole
			// command as one string avoids Node's shell+args deprecation warning.
			process.platform === 'win32' ? [command, ...args].join(' ') : command,
			process.platform === 'win32' ? [] : args,
			{ cwd: adminDir, stdio: 'inherit', shell: true, env: { ...process.env, ...extraEnv } }
		);
		child.on('error', (err) => rejectPromise(new Error(`无法执行 ${command}: ${err.message}`)));
		child.on('close', (code) => {
			const label = `${command} ${args.join(' ')}`;
			if (code !== 0) rejectPromise(new Error(`${label} 退出码 ${code}`));
			else resolvePromise();
		});
	});

// --- sanity ---------------------------------------------------------------
if (!existsSync(join(adminDir, 'package.json'))) {
	fail(`找不到 admin/package.json（adminDir=${adminDir}）`);
	process.exit(1);
}

// Refuse to write into anything that is not clearly the admin static target.
const backendParent = dirname(backendDir); // .../public
const backendPublic = dirname(backendParent); // .../backend
if (!/^public$/i.test(backendParent.split(/[\\/]/).pop() ?? '')) {
	fail(`目标目录的父级必须叫 public，实际是 "${backendParent}"。用 --backend 指定正确路径。`);
	process.exit(1);
}
if (!existsSync(backendPublic)) {
	fail(`后端目录不存在: ${backendPublic}`);
	process.exit(1);
}
if (backendDir === adminDir || adminDir.startsWith(backendDir + '\\') || adminDir.startsWith(backendDir + '/')) {
	fail(`拒绝操作：目标目录 ${backendDir} 会覆盖 admin 自身。`);
	process.exit(1);
}

console.log(paint('1', '校园直播导播协调系统 · 管理端构建发布'));
console.log(`    admin  : ${adminDir}`);
console.log(`    backend: ${backendDir}`);

// --- 1. install -----------------------------------------------------------
if (skipInstall) {
	step('跳过依赖安装 (--no-install)');
} else {
	step('安装依赖 (pnpm install)');
	// CI=true would force a frozen lockfile and defeat the point of this script.
	await run('pnpm', ['install'], { CI: '' });
	ok('依赖已就绪');
}

// --- 2. typecheck ---------------------------------------------------------
if (skipCheck) {
	step('跳过类型检查 (--no-check)');
} else {
	step('类型检查 (svelte-check)');
	await run('pnpm', ['run', 'check']);
	ok('0 errors');
}

// --- 3. build -------------------------------------------------------------
if (skipBuild) {
	step('跳过构建 (--skip-build)');
	if (!existsSync(join(buildDir, 'index.html'))) {
		fail(`没有可用的构建产物: ${buildDir}\\index.html 不存在`);
		process.exit(1);
	}
	ok('复用已有构建产物');
} else {
	step('构建静态站点 (pnpm build)');
	await run('pnpm', ['run', 'build']);
	ok('构建完成');
}

const builtIndex = join(buildDir, 'index.html');
if (!existsSync(builtIndex)) {
	fail(`构建产物缺少 index.html: ${builtIndex}`);
	process.exit(1);
}

// --- 4. deploy ------------------------------------------------------------
step('部署到后端静态目录');
mkdirSync(backendDir, { recursive: true });

// Clear stale hashed assets so old bundles do not accumulate.
let removed = 0;
for (const entry of readdirSync(backendDir)) {
	rmSync(join(backendDir, entry), { recursive: true, force: true });
	removed += 1;
}
ok(`已清空旧文件 (${removed} 项)`);

cpSync(buildDir, backendDir, { recursive: true });
const deployed = [];
(function walk(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full);
		else deployed.push(relative(backendDir, full));
	}
})(backendDir);
ok(`已复制 ${deployed.length} 个文件`);

// --- 5. verify ------------------------------------------------------------
step('校验部署结果');

if (!existsSync(join(backendDir, 'index.html'))) {
	fail('部署后缺少 index.html');
	process.exit(1);
}

const html = readFileSync(join(backendDir, 'index.html'), 'utf8');

// With base '/admin' every asset URL is root-relative; map it back onto the
// deployed directory and make sure the file is really there.
const assets = [...new Set([...html.matchAll(/["'](\/admin\/[^"']+)["']/g)].map((m) => m[1]))];
const missing = [];
for (const url of assets) {
	const rel = url.replace(/^\/admin\//, '');
	const target = join(backendDir, decodeURIComponent(rel));
	if (!existsSync(target) || statSync(target).isDirectory()) missing.push(url);
}

if (missing.length > 0) {
	fail(`${missing.length}/${assets.length} 个引用资源缺失:`);
	for (const url of missing.slice(0, 10)) console.log(`          ${url}`);
	process.exit(1);
}
ok(`index.html 引用的 ${assets.length} 个资源全部就位`);

if (!html.includes('__sveltekit')) {
	warn('index.html 里没看到 __sveltekit 启动数据，产物可能不是 SvelteKit 构建结果');
}

const totalBytes = deployed.reduce((sum, rel) => sum + statSync(join(backendDir, rel)).size, 0);
const mb = (totalBytes / 1024 / 1024).toFixed(2);

console.log(paint('32;1', `\n完成：${deployed.length} 个文件，${mb} MB -> ${backendDir}`));
console.log('重启后端（或重新加载静态目录）后访问 http://127.0.0.1:3000/admin');
