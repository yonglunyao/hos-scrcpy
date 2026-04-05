#!/usr/bin/env node
/**
 * hos-scrcpy CLI — HarmonyOS 投屏服务
 *
 * 用法: hos-scrcpy [options]
 *   --hdc <path>     HDC 工具路径 (默认: hdc)
 *   --port <port>    服务端口 (默认: 9523)
 *   --templates <dir> 前端模板目录
 */

import { exec } from 'child_process';
import { HosScrcpyServer } from '../server';
import {
  DEFAULT_SERVER_PORT,
  PORT_KILL_MAX_ATTEMPTS,
  PORT_KILL_DELAY_INCREMENT_MS,
} from '../constants';

/**
 * 查找并杀掉占用指定端口的进程，然后等待端口释放
 */
async function killPortOccupier(port: number): Promise<void> {
  const platform = process.platform;

  const getPid = (): Promise<string[]> => {
    return new Promise((resolve) => {
      let command: string;
      if (platform === 'win32') {
        command = `netstat -ano | findstr :${port}`;
      } else {
        command = `lsof -ti:${port}`;
      }
      const options: { shell?: string } = platform === 'win32' ? { shell: 'cmd.exe' } : {};
      exec(command, options, (_err, stdout) => {
        if (!stdout || stdout.trim() === '') {
          resolve([]);
          return;
        }
        const pids: string[] = [];
        if (platform === 'win32') {
          for (const line of stdout.split('\n')) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5 && parts[0]?.includes('TCP')) {
              const pid = parts[parts.length - 1];
              if (pid && pid !== '0') pids.push(pid);
            }
          }
        } else {
          pids.push(...stdout.trim().split('\n'));
        }
        resolve(pids);
      });
    });
  };

  const killPid = (pid: string): Promise<void> => {
    return new Promise((resolve) => {
      const killCmd = platform === 'win32'
        ? `taskkill /F /PID ${pid}`
        : `kill -9 ${pid}`;
      const options: { shell?: string } = platform === 'win32' ? { shell: 'cmd.exe' } : {};
      exec(killCmd, options, () => resolve());
    });
  };

  // 尝试最多3次
  for (let i = 0; i < PORT_KILL_MAX_ATTEMPTS; i++) {
    const pids = await getPid();
    if (pids.length === 0) {
      return; // 端口已释放
    }

    // 杀掉所有占用端口的进程
    for (const pid of pids) {
      await killPid(pid);
    }

    // 等待端口释放，每次等待时间递增
    await new Promise(r => setTimeout(r, PORT_KILL_DELAY_INCREMENT_MS * (i + 1)));
  }

  // 最后再检查一次
  const finalPids = await getPid();
  if (finalPids.length > 0) {
    console.warn(`[警告] 无法释放端口 ${port}，占用进程: ${finalPids.join(', ')}`);
  }
}

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

async function main() {
  const hdcPath = getArg('hdc') || process.env.HDC_PATH || 'hdc';
  const port = parseInt(getArg('port') || process.env.PORT || String(DEFAULT_SERVER_PORT), 10);
  const templatesDir = getArg('templates');

  // 自动杀掉占用端口的进程
  await killPortOccupier(port);

  console.log(`
  ╔══════════════════════════════════════╗
  ║     HarmonyOS Screen Cast Server     ║
  ║   hos-scrcpy v1.0.0                  ║
  ╠══════════════════════════════════════╣
  ║  HDC:     ${hdcPath.padEnd(28)}║
  ║  Port:    ${String(port).padEnd(28)}║
  ╚══════════════════════════════════════╝
  `);

  const server = new HosScrcpyServer({
    hdcPath,
    port,
    templatesDir,
  });

  await server.start();

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
