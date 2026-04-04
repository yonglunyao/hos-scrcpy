#!/usr/bin/env node
/**
 * 启动 UI - 自动检查并启动投屏服务器，然后打开浏览器
 */

const { exec } = require('child_process');
const net = require('net');
const path = require('path');

const HOST = '127.0.0.1';
const PORT = 9523;

// 获取项目根目录
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates');

/**
 * 检查端口是否被占用（通过尝试连接）
 */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(500);
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, HOST);
  });
}

/**
 * 启动服务器（带 templates 目录）
 */
function startServer() {
  console.log('[启动] 正在启动服务器...');
  const server = exec(`node dist/bin/server.js --templates "${TEMPLATES_DIR}"`, {
    stdio: 'inherit',
    shell: true,
    cwd: PROJECT_ROOT
  });

  // 等待服务器启动
  return new Promise((resolve) => {
    let attempts = 0;
    const checkInterval = setInterval(async () => {
      attempts++;
      const inUse = await isPortInUse(PORT);
      if (inUse) {
        clearInterval(checkInterval);
        console.log('[启动] 服务器已就绪');
        resolve();
      } else if (attempts > 30) {
        clearInterval(checkInterval);
        console.error('[错误] 服务器启动超时');
        process.exit(1);
      }
    }, 500);
  });
}

/**
 * 打开浏览器
 */
function openBrowser() {
  const url = `http://localhost:${PORT}`;
  console.log(`\n[浏览器] 打开 ${url}\n`);

  const platform = process.platform;
  let command;

  if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    command = `open "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  exec(command, (err) => {
    if (err) console.warn('[警告] 无法自动打开浏览器，请手动访问:', url);
  });
}

async function main() {
  console.log(`
╔══════════════════════════════════════╗
║     HarmonyOS Screen Cast UI         ║
║        投屏控制台                     ║
╚══════════════════════════════════════╝
`);

  // 检查 templates 目录
  const fs = require('fs');
  if (!fs.existsSync(TEMPLATES_DIR)) {
    console.error('[错误] templates 目录不存在:', TEMPLATES_DIR);
    process.exit(1);
  }

  // 检查服务器是否运行
  const serverRunning = await isPortInUse(PORT);

  if (!serverRunning) {
    await startServer();
  } else {
    console.log('[就绪] 服务器已在运行');
  }

  openBrowser();

  // 保持进程运行（如果是本脚本启动的服务器）
  if (!serverRunning) {
    console.log('[提示] 按 Ctrl+C 停止服务器');
  }
}

main().catch(console.error);
