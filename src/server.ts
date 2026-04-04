import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { DeviceManager, ScrcpyConfig, ScreenSize } from './device/manager';
import { UitestServer } from './input/uitest';
import { DirectScrcpyStream } from './capture/direct-scrcpy';
import { getHdcKeyCode } from './input/keycode';

export interface ServerConfig {
  host?: string;
  port?: number;
  hdcPath?: string;
  templatesDir?: string;
}

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

  constructor(config: ServerConfig = {}) {
    this.config = {
      host: config.host || '0.0.0.0',
      port: config.port || 9523,
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
        const url = `http://${this.config.host === '0.0.0.0' ? 'localhost' : this.config.host}:${this.config.port}`;
        console.log(`\n✓ HosScrcpyServer started at ws://${this.config.host}:${this.config.port}`);
        console.log(`\n  🌐 前端访问地址:`);
        console.log(`     ${url}`);
        console.log(`\n  📡 可用接口:`);
        console.log(`     GET  /api/devices          - 获取设备列表`);
        console.log(`     WS   /ws/screen/{sn}       - 投屏连接`);
        console.log(`     WS   /ws/uitest/{sn}       - UiTest 模式\n`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const ctx of this.devices.values()) {
      await ctx.stop();
    }
    this.devices.clear();
    this.wss.close();
    this.httpServer.close();
  }

  // ========== HTTP ==========

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url || '/';
    console.log(`[HTTP] ${req.method} ${url}`);

    if (url === '/api/devices' || url === '/api/devices/') {
      this.handleApiDevices(req, res);
      return;
    }

    // Serve static files from templates dir
    if (this.config.templatesDir) {
      const filePath = path.join(this.config.templatesDir, url === '/' ? 'index.html' : url);
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
          if (ctx.getClientCount() === 0) {
            console.log(`[WS] No more clients for device ${sn}, cleaning up`);
            // 同步移除，防止新客户端复用已关闭的 DeviceContext
            this.devices.delete(sn);
            // 异步清理资源（不阻塞新连接）
            ctx.stop().catch(e => console.warn('[WS] cleanup error:', e.message));
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
        await ctx.manager.shell(`uinput -K -d ${hdcCode} -u ${hdcCode}`, 2);
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
      scale: 2,             // 使用之前工作的参数
      frameRate: 60,
      bitRate: 8,           // 8 Mbps
    });

    if (clientId) {
      ctx.addClient(clientId);
      this.clientToDevice.set(clientId, sn);
    }
    this.devices.set(sn, ctx);
    return ctx;
  }
}

/**
 * 设备上下文 — 管理单个设备的所有投屏和输入资源
 */
class DeviceContext {
  manager: DeviceManager;
  uitest: UitestServer;
  scrcpyStream: DirectScrcpyStream | null = null;
  private activeCastType: 'screen' | 'uitest' | null = null;
  private clients = new Set<string>();
  private wsClients = new Map<string, WebSocket>();
  private scrcpyStarted = false;
  private startLock: Promise<void> | null = null;

  constructor(config: ScrcpyConfig) {
    this.manager = new DeviceManager(config);
    this.uitest = new UitestServer(this.manager);
  }

  addClient(clientId: string): void {
    this.clients.add(clientId);
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
    this.wsClients.delete(clientId);
  }

  getClientCount(): number {
    return this.clients.size;
  }


  async startScreenCast(ws: WebSocket, clientId?: string): Promise<void> {
    if (clientId) {
      this.wsClients.set(clientId, ws);
      console.log(`[DeviceContext] Client ${clientId} added to wsClients, total: ${this.wsClients.size}`);
    }

    if (this.scrcpyStarted) {
      console.log(`[DeviceContext] scrcpy already running, client ${clientId} reusing existing stream`);
      return;
    }

    // 等待正在进行的启动完成
    if (this.startLock) {
      console.log(`[DeviceContext] client ${clientId} waiting for ongoing scrcpy start`);
      await this.startLock;
      return;
    }

    let resolveLock!: () => void;
    this.startLock = new Promise<void>(r => { resolveLock = r; });

    try {
      // 停止之前的投屏模式
      await this.manager.stopScrcpy();

      // 启动 uitest（用于输入控制），与 scrcpy 启动并行
      const startUitest = this.uitest.start().catch(e =>
        console.warn('[DeviceContext] uitest start failed (non-fatal):', e.message)
      );

      // 使用 DeviceManager 的统一启动流程（包含版本检测、SO匹配、进程启动、端口转发）
      const forwardPort = await this.manager.startScrcpyWithForward();
      console.log('[DeviceContext] scrcpy forward port:', forwardPort);

      this.scrcpyStream = new DirectScrcpyStream(this.manager);
      this.activeCastType = 'screen';

      await startUitest;

      this.scrcpyStream.start({
        onData: (data: Buffer) => {
          for (const [id, clientWs] of this.wsClients) {
            if (clientWs.readyState === WebSocket.OPEN) {
              try {
                clientWs.send(data, (err) => {
                  if (err) {
                    console.error(`[DeviceContext] Send error to ${id}:`, err.message);
                  }
                });
              } catch (err) {
                console.error(`[DeviceContext] Failed to send to client ${id}:`, err);
              }
            }
          }
        },
        onReady: () => {
          console.log('[DeviceContext] screen cast ready');
          this.scrcpyStarted = true;
          // 通知所有客户端 scale 倍率，用于触控坐标映射
          const scale = this.manager.getScale();
          for (const [id, clientWs] of this.wsClients) {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: 'screenConfig', scale }));
            }
          }
        },
        onError: (err: Error) => {
          console.error('[DeviceContext] screen cast error:', err.message);
        },
      });
    } finally {
      this.startLock = null;
      resolveLock();
    }
  }

  async startUitestCast(ws: WebSocket): Promise<void> {
    await this.stopCast();
    await this.uitest.start();
    this.activeCastType = 'uitest';

    await this.manager.shell('uinput -M -m 100 100 120 100 1000 --trace', 3);
    await new Promise(r => setTimeout(r, 1000));
    await this.manager.shell('uinput -T -c 0 0', 3);

    console.log('[DeviceContext] uitest cast started (image mode)');

    // Get screen size
    const size = await this.uitest.getScreenSize();
    console.log(`[DeviceContext] screen size: ${size.width}x${size.height}`);

    // Send ready message with screen size
    ws.send(JSON.stringify({
      type: 'ready',
      width: size.width,
      height: size.height,
      message: 'uitest cast ready'
    }));

    // Start periodic screen capture
    const captureInterval = setInterval(async () => {
      if (this.activeCastType !== 'uitest') {
        clearInterval(captureInterval);
        return;
      }

      try {
        const layout = await this.uitest.getLayout();
        if (layout) {
          // Ensure layout is a string
          const layoutStr = typeof layout === 'string' ? layout : JSON.stringify(layout);
          ws.send(JSON.stringify({
            type: 'data',
            data: layoutStr
          }));
        }
      } catch (e) {
        console.error('[DeviceContext] capture error:', (e as Error).message);
      }
    }, 500); // 2 FPS

    // Store interval for cleanup
    (ws as any).captureInterval = captureInterval;
  }

  async stopCast(): Promise<void> {
    if (this.scrcpyStream) {
      await this.scrcpyStream.stop();
      this.scrcpyStream = null;
    }
    await this.manager.stopScrcpy();
    this.scrcpyStarted = false;
    this.activeCastType = null;
  }

  /**
   * Stop capture interval for a specific WebSocket
   */
  stopCaptureForWs(ws: WebSocket): void {
    const interval = (ws as any).captureInterval;
    if (interval) {
      clearInterval(interval);
      delete (ws as any).captureInterval;
    }
  }

  async stop(): Promise<void> {
    await this.stopCast();
    await this.uitest.stop();
    // 关闭所有 WebSocket 连接
    for (const [id, ws] of this.wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    this.wsClients.clear();
  }
}
