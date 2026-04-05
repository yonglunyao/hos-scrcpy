import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { DeviceManager, ScrcpyConfig, ScreenSize } from './device/manager';
import { DeviceContext } from './device/context';
import { UitestServer } from './input/uitest';
import { DirectScrcpyStream } from './capture/direct-scrcpy';
import { getHdcKeyCode } from './input/keycode';
import type { ServerConfig } from './types';
import {
  DEFAULT_SERVER_PORT,
  DEFAULT_HDC_PORT,
  DEFAULT_SCALE,
  DEFAULT_FRAME_RATE,
  DEFAULT_BIT_RATE_MBPS,
  UINPUT_TOUCH_TIMEOUT_SEC,
} from './constants';

/**
 * HosScrcpyServer — 完整的 HarmonyOS 投屏服务
 *
 * 与原 demoWithoutRecord.jar 的 WebSocket 协议完全兼容，
 * 可直接替换 ohos-screen-cast 的 Python 后端。
 */
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

export class HosScrcpyServer {
  private httpServer: http.Server;
  private wss: WebSocketServer;
  private config: ServerConfig;
  private devices = new Map<string, DeviceContext>();
  private clientIdCounter = 0;
  private clientToDevice = new Map<string, string>();  // clientId -> device sn
  private resolvedPort: number | null = null;  // 存储实际监听端口（支持动态端口）

  constructor(config: ServerConfig = {}) {
    this.config = {
      host: config.host || '0.0.0.0',
      port: config.port !== undefined ? config.port : DEFAULT_SERVER_PORT,
      hdcPath: config.hdcPath || 'hdc',
      templatesDir: config.templatesDir,
    };

    this.httpServer = http.createServer((req, res) => this.handleHttpRequest(req, res));
    this.wss = new WebSocketServer({ noServer: true });
    this.httpServer.on('upgrade', (req, socket, head) => {
      const url = req.url || '/';
      console.log(`[HTTP] WebSocket upgrade request: ${url}`);
      if (url.startsWith('/ws/')) {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit('connection', ws, req);
        });
      } else {
        console.log(`[HTTP] WebSocket upgrade rejected: ${url} doesn't start with /ws/`);
        socket.destroy();
      }
    });
    this.wss.on('connection', (ws, req) => this.handleWebSocketConnection(ws, req));
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.config.port, this.config.host, () => {
        const addr = this.httpServer.address();
        if (addr && typeof addr === 'object') {
          this.resolvedPort = addr.port;
        } else if (typeof addr === 'string') {
          const match = addr.match(/:(\d+)$/);
          this.resolvedPort = match ? parseInt(match[1], 10) : this.config.port || DEFAULT_SERVER_PORT;
        } else {
          this.resolvedPort = this.config.port || DEFAULT_SERVER_PORT;
        }
        const url = `http://${this.config.host === '0.0.0.0' ? 'localhost' : this.config.host}:${this.resolvedPort}`;
        console.log(`\n✓ HosScrcpyServer started at ws://${this.config.host}:${this.resolvedPort}`);
        console.log(`\n  🌐 前端访问地址:`);
        console.log(`     ${url}`);
        console.log(`\n  📡 可用接口:`);
        console.log(`     GET  /api/devices          - 获取设备列表`);
        console.log(`     GET  /api/status           - 获取投屏状态`);
        console.log(`     WS   /ws/screen/{sn}       - 投屏连接`);
        console.log(`     WS   /ws/uitest/{sn}       - UiTest 模式\n`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    // 先停止所有设备投屏
    await this.stopAll();
    // 关闭 HTTP/WS 服务器
    this.wss.close();
    this.httpServer.close();
  }

  /**
   * 启动指定设备的投屏（编程式 API，不依赖 WebSocket 客户端触发）
   * @param sn 设备序列号
   */
  async startDevice(sn: string): Promise<void> {
    let ctx = this.devices.get(sn);
    if (ctx) {
      // 幂等：如果已在投屏，直接返回
      if (ctx.isScrcpyStarted()) {
        console.log(`[HosScrcpyServer] Device ${sn} already casting`);
        return;
      }
    } else {
      // 创建新的 DeviceContext，标记为持久化（无 WS 客户端时也保持）
      ctx = new DeviceContext({
        sn,
        ip: '127.0.0.1',
        hdcPath: this.config.hdcPath,
        hdcPort: DEFAULT_HDC_PORT,
        scale: DEFAULT_SCALE,
        frameRate: DEFAULT_FRAME_RATE,
        bitRate: 8,
        persistent: true,  // 标记为持久化设备
      });
      this.devices.set(sn, ctx);
    }

    // 启动投屏（不需要 WS 客户端）
    await ctx.startScreenCast();
    console.log(`[HosScrcpyServer] Device ${sn} casting started`);
  }

  /**
   * 停止指定设备的投屏，清理所有资源
   * @param sn 设备序列号
   */
  async stopDevice(sn: string): Promise<void> {
    const ctx = this.devices.get(sn);
    if (!ctx) {
      console.log(`[HosScrcpyServer] Device ${sn} not casting`);
      return;  // 幂等：未投屏时直接返回
    }

    await ctx.stop();
    this.devices.delete(sn);
    console.log(`[HosScrcpyServer] Device ${sn} stopped`);
  }

  /**
   * 停止所有设备的投屏
   */
  async stopAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const ctx of this.devices.values()) {
      promises.push(ctx.stop());
    }
    await Promise.all(promises);
    this.devices.clear();
    console.log(`[HosScrcpyServer] All devices stopped`);
  }

  /**
   * 检查指定设备是否正在投屏
   * @param sn 设备序列号
   */
  isCasting(sn: string): boolean {
    const ctx = this.devices.get(sn);
    return ctx !== undefined && ctx.isScrcpyStarted();
  }

  /**
   * 返回实际监听端口
   * 支持 config.port = 0 时的动态端口分配
   */
  getPort(): number {
    return this.resolvedPort || this.config.port || DEFAULT_SERVER_PORT;
  }

  // ========== HTTP ==========

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url || '/';
    console.log(`[HTTP] ${req.method} ${url}`);

    if (url === '/api/devices' || url === '/api/devices/') {
      this.handleApiDevices(req, res);
      return;
    }

    if (url.startsWith('/api/status')) {
      this.handleApiStatus(req, res);
      return;
    }

    // Serve static files from templates dir
    if (this.config.templatesDir) {
      // 支持 /webview/* 路径映射
      let relativePath: string;
      if (url.startsWith('/webview/')) {
        relativePath = url.slice('/webview/'.length);
        // 避免 path traversal
        relativePath = relativePath.replace(/\.\./g, '');
      } else {
        relativePath = url === '/' ? 'index.html' : url.slice(1);
      }
      const filePath = path.join(this.config.templatesDir, relativePath);
      console.log(`[HTTP] static file: ${filePath}, exists: ${fs.existsSync(filePath)}`);
      if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
        res.writeHead(200, { 'Content-Type': getContentType(filePath) });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    // 根路径返回 API 使用说明
    if (url === '/') {
      const html = `<!DOCTYPE html>
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
    <pre>curl http://localhost:9523/api/devices</pre>
  </div>

  <div class="endpoint">
    <span class="method get">GET</span> <code>/api/status[?sn=DEVICE_SN]</code>
    <p>获取投屏状态</p>
    <pre>curl http://localhost:9523/api/status?sn=设备序列号</pre>
  </div>

  <div class="endpoint">
    <span class="method ws">WS</span> <code>/ws/screen/{sn}</code>
    <p>投屏 WebSocket 连接</p>
    <pre>
const ws = new WebSocket('ws://localhost:9523/ws/screen/设备序列号');
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
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  }

  private async handleApiDevices(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const { exec } = require('child_process');
      const hdc = this.config.hdcPath;
      const result = await new Promise<string>((resolve) => {
        exec(`${hdc} list targets`, (err: Error | null, stdout: string) => {
          resolve(stdout);
        });
      });
      const devices = result
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('['));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ devices, count: devices.length }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
  }

  private handleApiStatus(req: http.IncomingMessage, res: http.ServerResponse): void {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const sn = url.searchParams.get('sn');

      res.writeHead(200, { 'Content-Type': 'application/json' });

      if (sn) {
        // 返回指定设备状态
        const casting = this.isCasting(sn);
        res.end(JSON.stringify({ casting, sn }));
      } else {
        // 返回所有设备状态
        const devices: Record<string, { casting: boolean }> = {};
        for (const [deviceSn, ctx] of this.devices.entries()) {
          devices[deviceSn] = { casting: ctx.isScrcpyStarted() };
        }
        res.end(JSON.stringify({ devices }));
      }
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
  }


  // ========== WebSocket ==========

  private async handleWebSocketConnection(ws: WebSocket, req: http.IncomingMessage): Promise<void> {
    const urlPath = req.url || '/';
    console.log(`[WS] Client connected: ${urlPath}`);

    // 生成唯一客户端 ID
    const clientId = `ws-${++this.clientIdCounter}-${Date.now()}`;

    // 从 URL 路径提取 SN: /ws/screen/{sn}
    const parts = urlPath.split('/').filter(Boolean);
    const urlSn = parts.length >= 3 ? parts[2]! : '';

    ws.on('message', async (raw) => {
      try {
        const message = typeof raw === 'string' ? raw : raw.toString('utf-8');
        await this.handleWsMessage(ws, message, urlSn, clientId);
      } catch (err) {
        console.error('[WS] Message handler error:', err);
      }
    });

    ws.on('close', async (code: number, reason: Buffer) => {
      const reasonStr = reason ? reason.toString('utf8') : '';
      console.log(`[WS] Client disconnected: ${clientId}, code: ${code}, reason: ${reasonStr || 'none'}`);
      const sn = this.clientToDevice.get(clientId);
      if (sn) {
        const ctx = this.devices.get(sn);
        if (ctx) {
          ctx.stopCaptureForWs(ws);
          await ctx.removeClient(clientId);
          if (ctx.getClientCount() === 0 && !ctx.isPersistent()) {
            // 非持久化设备，最后一个客户端断开时清理
            console.log(`[WS] No more clients for device ${sn}, cleaning up`);
            // 同步移除，防止新客户端复用已关闭的 DeviceContext
            this.devices.delete(sn);
            // 异步清理资源（不阻塞新连接）
            ctx.stop().catch(e => console.warn('[WS] cleanup error:', e.message));
          } else if (ctx.getClientCount() === 0 && ctx.isPersistent()) {
            // 持久化设备，保留投屏流
            console.log(`[WS] No more clients for persistent device ${sn}, keeping stream alive`);
          }
        }
        this.clientToDevice.delete(clientId);
      }
    });
  }

  private async handleWsMessage(ws: WebSocket, message: string, urlSn?: string, clientId?: string): Promise<void> {
    const jsonMsg = JSON.parse(message.replace(/\\/g, '\\\\'));
    const type: string = jsonMsg.type;
    const sn: string = jsonMsg.sn || urlSn || '';
    const remoteIp: string = jsonMsg.remoteIp || '';
    const remotePort: string = jsonMsg.remotePort || '';
    const msg: Record<string, unknown> = jsonMsg.message || {};

    if (type === 'screen') {
      await this.handleScreenCast(ws, sn, remoteIp, remotePort, msg, clientId);
    } else if (type === 'uitest') {
      await this.handleUitestCast(ws, sn, remoteIp, remotePort, msg);
    } else if (type === 'touchEvent') {
      await this.handleTouchEvent(ws, sn, msg);
    } else if (type === 'keyCode') {
      await this.handleKeyCode(ws, sn, msg);
    } else if (type === 'stop') {
      await this.handleStop(ws, sn);
    }
  }

  // ========== Screen cast (Direct TCP to scrcpy) ==========

  private async handleScreenCast(
    ws: WebSocket, sn: string, remoteIp: string, remotePort: string,
    _msg: Record<string, unknown>, clientId?: string,
  ): Promise<void> {
    const ctx = await this.getOrCreateDevice(ws, sn, remoteIp, remotePort, clientId);
    await ctx.startScreenCast(ws, clientId);
  }

  // ========== UiTest cast (image capture) ==========

  private async handleUitestCast(
    ws: WebSocket, sn: string, remoteIp: string, remotePort: string,
    _msg: Record<string, unknown>,
  ): Promise<void> {
    const ctx = await this.getOrCreateDevice(ws, sn, remoteIp, remotePort);
    await ctx.startUitestCast(ws);
  }

  // ========== Touch events ==========

  private async handleTouchEvent(ws: WebSocket, sn: string, msg: Record<string, unknown>): Promise<void> {
    const ctx = this.devices.get(sn);
    console.log(`[WS] touch event: sn=${sn}, ctx=${!!ctx}, uitestRunning=${ctx?.uitest?.isUitestRunning()}`);
    if (!ctx?.uitest?.isUitestRunning()) {
      console.warn(`[WS] touch event ignored: uitest not running`);
      return;
    }

    const event = msg.event as string;
    const x = msg.x as number;
    const y = msg.y as number;
    console.log(`[WS] touch: ${event} at (${x}, ${y})`);

    try {
      if (event === 'down') {
        await ctx.uitest.touchDown(x, y);
      } else if (event === 'up') {
        await ctx.uitest.touchUp(x, y);
      } else if (event === 'move') {
        await ctx.uitest.touchMove(x, y);
      }
    } catch (err: any) {
      console.error(`[WS] touch ${event} error:`, err.message);
    }
  }

  // ========== Key code ==========

  private async handleKeyCode(ws: WebSocket, sn: string, msg: Record<string, unknown>): Promise<void> {
    const ctx = this.devices.get(sn);
    if (!ctx) return;

    const key = msg.key as string;
    const code = msg.code as string;
    const hdcCode = getHdcKeyCode(key, code);
    if (hdcCode !== null) {
      // HOME/BACK 优先用 uitest API，其他按键用 uinput
      const handled = ctx.uitest?.isUitestRunning() ? await ctx.uitest.pressKey(hdcCode) : false;
      if (!handled) {
        await ctx.manager.shell(`uinput -K -d ${hdcCode} -u ${hdcCode}`, UINPUT_TOUCH_TIMEOUT_SEC);
      }
    }
  }

  // ========== Stop ==========

  private async handleStop(ws: WebSocket, sn: string): Promise<void> {
    const ctx = this.devices.get(sn);
    if (!ctx) return;
    await ctx.stop();
    this.devices.delete(sn);
  }

  // ========== Device context management ==========

  private async getOrCreateDevice(
    ws: WebSocket, sn: string, remoteIp: string, remotePort: string, clientId?: string,
  ): Promise<DeviceContext> {
    let ctx = this.devices.get(sn);
    if (ctx) {
      if (clientId) {
        ctx.addClient(clientId);
        this.clientToDevice.set(clientId, sn);
      }
      return ctx;
    }

    ctx = new DeviceContext({
      sn,
      ip: remoteIp || '127.0.0.1',
      hdcPath: this.config.hdcPath,
      hdcPort: remotePort ? parseInt(remotePort, 10) : 8710,
      scale: DEFAULT_SCALE,             // 使用之前工作的参数
      frameRate: DEFAULT_FRAME_RATE,
      bitRate: DEFAULT_BIT_RATE_MBPS,
    });

    if (clientId) {
      ctx.addClient(clientId);
      this.clientToDevice.set(clientId, sn);
    }
    this.devices.set(sn, ctx);
    return ctx;
  }
}

