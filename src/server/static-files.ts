/**
 * 静态文件服务 — MIME 类型、文件提供、默认 HTML 页面
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

export function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
  };
  return types[ext] || 'application/octet-stream';
}

/**
 * 尝试从 templates 目录提供静态文件，返回是否成功处理
 */
export function serveStaticFile(
  templatesDir: string | undefined,
  url: string,
  res: http.ServerResponse,
): boolean {
  if (!templatesDir) return false;

  let relativePath: string;
  if (url.startsWith('/webview/')) {
    relativePath = url.slice('/webview/'.length);
    relativePath = relativePath.replace(/\.\./g, '');
  } else {
    relativePath = url === '/' ? 'index.html' : url.slice(1);
  }

  const filePath = path.join(templatesDir, relativePath);
  if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
    res.writeHead(200, { 'Content-Type': getContentType(filePath) });
    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  return false;
}

/**
 * 生成默认的 API 文档 HTML 页面
 */
export function getDefaultHtml(port: number): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>HarmonyOS Screen Cast API</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 40px auto; padding: 20px; }
    h1 { color: #333; }
    .endpoint { background: #f5f5f5; padding: 15px; margin: 10px 0; border-radius: 8px; }
    .method { display: inline-block; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
    .get { background: #4CAF50; color: white; }
    .ws { background: #2196F3; color: white; }
    code { background: #e0e0e0; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>HarmonyOS Screen Cast API</h1>
  <h2>可用接口</h2>

  <div class="endpoint">
    <span class="method get">GET</span> <code>/api/devices</code>
    <p>获取设备列表</p>
    <pre>curl http://localhost:${port}/api/devices</pre>
  </div>

  <div class="endpoint">
    <span class="method get">GET</span> <code>/api/status[?sn=DEVICE_SN]</code>
    <p>获取投屏状态</p>
    <pre>curl http://localhost:${port}/api/status?sn=设备序列号</pre>
  </div>

  <div class="endpoint">
    <span class="method ws">WS</span> <code>/ws/screen/{sn}</code>
    <p>投屏 WebSocket 连接</p>
    <pre>
const ws = new WebSocket('ws://localhost:${port}/ws/screen/设备序列号');
ws.send(JSON.stringify({
  type: 'screen',
  sn: '设备序列号',
  remoteIp: '127.0.0.1',
  remotePort: '8710'
}));</pre>
  </div>

  <div class="endpoint">
    <span class="method ws">WS</span> <code>/ws/uitest/{sn}</code>
    <p>UiTest 模式 WebSocket</p>
  </div>

  <h2>编程式 API (Node.js)</h2>
  <pre>
import { HosScrcpyServer } from 'hos-scrcpy';

const server = new HosScrcpyServer({ port: 8899 });
await server.start();

// 启动指定设备投屏
await server.startDevice('设备序列号');

// 检查是否投屏中
console.log(server.isCasting('设备序列号'));

// 停止设备投屏
await server.stopDevice('设备序列号');

// 停止所有投屏
await server.stopAll();

// 获取实际端口
console.log('Port:', server.getPort());</pre>

  <h2>WebSocket 消息类型</h2>
  <ul>
    <li><code>screen</code> - 启动投屏 (H.264 视频)</li>
    <li><code>uitest</code> - UiTest 图像模式</li>
    <li><code>touchEvent</code> - 触摸事件 {event: 'down|up|move', x, y}</li>
    <li><code>keyCode</code> - 按键事件 {key, code}</li>
    <li><code>stop</code> - 停止投屏</li>
  </ul>
</body>
</html>`;
}
