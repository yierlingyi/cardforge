#!/usr/bin/env node
/**
 * CardForge 一键启动器（跨平台）
 *
 * 做的事情：检查 Node 版本 → 缺依赖就装 → 启动 Vite → 等端口就绪 → 打开浏览器。
 * 用法：
 *   node scripts/launch.mjs            开发模式（默认，热更新）
 *   node scripts/launch.mjs --prod     生产模式（先构建再预览）
 *   node scripts/launch.mjs --no-open  只启动，不开浏览器
 *   PORT=6000 node scripts/launch.mjs  换端口
 */
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGV = process.argv.slice(2);
const PROD = ARGV.includes('--prod') || ARGV.includes('--build');
const NO_OPEN = ARGV.includes('--no-open') || ARGV.includes('--no-browser');
const PORT = Number(process.env.PORT || (PROD ? 5179 : 5178));
const HOST = '127.0.0.1';
const URL = `http://localhost:${PORT}/`;

const isWin = process.platform === 'win32';

function line(char = '─') {
  console.log(char.repeat(52));
}

function bail(msg, hint) {
  console.error('');
  console.error(`✖ ${msg}`);
  if (hint) console.error(`  ${hint}`);
  console.error('');
  process.exit(1);
}

/* ---------------------------------------------------------------- 1. 环境检查 */

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  bail(`Node.js 版本过低（当前 ${process.versions.node}）`, '请安装 Node.js 18 或更高版本：https://nodejs.org/');
}

line('═');
console.log('  CardForge · SillyTavern 人物卡 IDE');
console.log(`  ${PROD ? '生产预览' : '开发模式'}   Node ${process.versions.node}   ${process.platform}`);
line('═');
console.log('');

/* ---------------------------------------------------------------- 2. 依赖安装 */

/**
 * 判断是否需要 npm install：
 * - node_modules/vite 不存在 → 必须装
 * - package.json 比 node_modules/.package-lock.json 新 → 装
 */
function needsInstall() {
  const viteDir = path.join(ROOT, 'node_modules', 'vite');
  if (!existsSync(viteDir)) return true;
  const pkg = path.join(ROOT, 'package.json');
  const stamp = path.join(ROOT, 'node_modules', '.package-lock.json');
  if (!existsSync(stamp)) return false;
  try {
    return statSync(pkg).mtimeMs > statSync(stamp).mtimeMs + 1000;
  } catch {
    return false;
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: isWin, ...opts });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}`))));
  });
}

if (needsInstall()) {
  console.log('▸ 首次运行（或依赖有更新），正在安装依赖…');
  console.log('  这一步可能需要 1–3 分钟，只会执行一次。');
  console.log('');
  try {
    await run('npm', ['install', '--no-audit', '--no-fund']);
  } catch (e) {
    bail(`依赖安装失败：${e.message}`, '可手动执行 `npm install` 查看完整错误；国内网络可先设置镜像：npm config set registry https://registry.npmmirror.com');
  }
  console.log('');
  console.log('✔ 依赖安装完成');
  console.log('');
} else {
  console.log('▸ 依赖已就绪，跳过安装');
}

/* ---------------------------------------------------------------- 3. 端口占用检查 */

function probe(url, timeout = 900) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeout, () => {
      req.destroy();
      resolve(false);
    });
  });
}

if (await probe(URL)) {
  console.log(`▸ ${URL} 已经在运行，无需重复启动`);
  if (!NO_OPEN) {
    console.log('  正在打开浏览器…');
    openBrowser(URL);
  }
  process.exit(0);
}

/* ---------------------------------------------------------------- 4. 启动服务 */

const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(viteBin)) {
  bail('找不到本地 Vite，依赖可能损坏', '请删除 node_modules 后重新运行本脚本');
}

const modeArgs = PROD
  ? ['build', '--logLevel', 'warn']
  : ['--port', String(PORT), '--strictPort', '--host', HOST];

if (PROD) {
  console.log('▸ 正在构建生产版本…');
  try {
    await run(process.execPath, [viteBin, 'build', '--logLevel', 'warn']);
  } catch {
    bail('构建失败', '可执行 npm run typecheck 查看类型错误');
  }
  console.log('✔ 构建完成');
  console.log('');
}

console.log(`▸ 正在启动${PROD ? '预览' : '开发'}服务器…`);
console.log('');

const serverArgs = PROD ? [viteBin, 'preview', '--port', String(PORT), '--strictPort', '--host', HOST] : [viteBin, ...modeArgs];
const server = spawn(process.execPath, serverArgs, { cwd: ROOT, stdio: 'inherit' });

let opened = false;

server.on('error', (e) => bail(`无法启动服务器：${e.message}`));

// 轮询等待端口就绪后打开浏览器
(async () => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await probe(URL, 500)) {
      if (!opened) {
        opened = true;
        console.log('');
        line();
        console.log(`  已就绪：${URL}`);
        console.log('  关闭本窗口或按 Ctrl+C 即可停止服务');
        line();
        console.log('');
        if (!NO_OPEN) openBrowser(URL);
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.error(`\n⚠ 等待 60 秒仍未响应，请手动访问 ${URL}`);
})();

server.on('exit', (code) => {
  process.exit(code ?? 0);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.kill(sig);
    setTimeout(() => process.exit(0), 300);
  });
}

/* ---------------------------------------------------------------- 工具函数 */

function openBrowser(url) {
  try {
    if (isWin) {
      // start 的第一个参数是窗口标题，必须给空串
      spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true, windowsVerbatimArguments: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
    }
  } catch {
    console.log(`请手动在浏览器打开：${url}`);
  }
}
