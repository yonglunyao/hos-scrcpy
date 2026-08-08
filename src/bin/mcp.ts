#!/usr/bin/env node
/**
 * hos-scrcpy-mcp — MCP server CLI 入口(stdio transport)。
 *
 * 用法:
 *   node dist/bin/mcp.js            # 直接运行(已 build)
 *   npm run mcp                     # 同上
 * 环境变量:
 *   HDC_PATH  hdc 可执行文件路径 (默认: hdc)
 *
 * 注意:首行 import './console-redirect' 必须最先,确保 stdout 仅承载 MCP 协议。
 */

import '../mcp/console-redirect';
import { runMcpServer } from '../mcp';
import { setHdcPath } from '../mcp/session';

async function main(): Promise<void> {
  setHdcPath(process.env.HDC_PATH || 'hdc');
  await runMcpServer();
}

process.on('SIGINT', async () => {
  const { disconnectSession } = await import('../mcp/session');
  await disconnectSession();
  process.exit(0);
});

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[hos-scrcpy-mcp] Fatal: ${msg}\n`);
  process.exit(1);
});
