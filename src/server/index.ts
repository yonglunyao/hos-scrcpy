/**
 * HosScrcpyServer — 门面
 *
 * HTTP/WS 路由委托给 HttpHandler 和 WsHandler。
 */

import * as http from 'http';
import { WebSocketServer } from 'ws';
import { DeviceContext } from '../device/context';
import { DeviceFactory, IDeviceFactory } from '../device/factory';
import type { ServerConfig } from '../shared/types';
import { DEFAULT_SERVER_PORT, DEFAULT_HDC_PORT, DEFAULT_SCALE, DEFAULT_FRAME_RATE, DEFAULT_BIT_RATE_MBPS } from '../constants';
import { HttpHandler } from './http-handler';
import { WsHandler } from './ws-handler';
// Re-export for backward compatibility
export { getContentType } from './static-files';

export class HosScrcpyServer {
  private httpServer: http.Server;
  private config: ServerConfig;
  private devices = new Map<string, DeviceContext>();
  private factory: IDeviceFactory;
  private httpHandler: HttpHandler;
  private wsHandler: WsHandler;
  private resolvedPort: number | null = null;

  constructor(config: ServerConfig = {}, factory?: IDeviceFactory) {
    this.config = {
      host: config.host || '0.0.0.0',
      port: config.port !== undefined ? config.port : DEFAULT_SERVER_PORT,
      hdcPath: config.hdcPath || 'hdc',
      templatesDir: config.templatesDir,
    };

    this.factory = factory || new DeviceFactory();

    this.httpHandler = new HttpHandler(
      this.config,
      this.devices as unknown as Map<string, unknown>,
      (sn: string) => this.isCasting(sn),
    );

    this.wsHandler = new WsHandler(this.config, this.devices, this.factory);

    this.httpServer = http.createServer((req, res) => this.httpHandler.handleRequest(req, res));
    const wss = new WebSocketServer({ noServer: true });
    this.httpServer.on('upgrade', (req, socket, head) => {
      const url = req.url || '/';
      console.log(`[HTTP] WebSocket upgrade request: ${url}`);
      if (url.startsWith('/ws/')) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      } else {
        console.log(`[HTTP] WebSocket upgrade rejected: ${url} doesn't start with /ws/`);
        socket.destroy();
      }
    });
    wss.on('connection', (ws, req) => this.wsHandler.handleConnection(ws, req));
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
    await this.stopAll();
    this.httpServer.close();
  }

  async startDevice(sn: string): Promise<void> {
    let ctx = this.devices.get(sn);
    if (ctx) {
      if (ctx.isScrcpyStarted()) {
        console.log(`[HosScrcpyServer] Device ${sn} already casting`);
        return;
      }
    } else {
      const newCtx = this.factory.createDeviceContext({
        sn,
        ip: '127.0.0.1',
        hdcPath: this.config.hdcPath,
        hdcPort: DEFAULT_HDC_PORT,
        scale: DEFAULT_SCALE,
        frameRate: DEFAULT_FRAME_RATE,
        bitRate: DEFAULT_BIT_RATE_MBPS,
        persistent: true,
      });
      ctx = newCtx as DeviceContext;
      this.devices.set(sn, ctx);
    }

    await ctx.startScreenCast();
    console.log(`[HosScrcpyServer] Device ${sn} casting started`);
  }

  async stopDevice(sn: string): Promise<void> {
    const ctx = this.devices.get(sn);
    if (!ctx) {
      console.log(`[HosScrcpyServer] Device ${sn} not casting`);
      return;
    }

    await ctx.stop();
    this.devices.delete(sn);
    console.log(`[HosScrcpyServer] Device ${sn} stopped`);
  }

  async stopAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const ctx of this.devices.values()) {
      promises.push(ctx.stop());
    }
    await Promise.all(promises);
    this.devices.clear();
    console.log(`[HosScrcpyServer] All devices stopped`);
  }

  isCasting(sn: string): boolean {
    const ctx = this.devices.get(sn);
    return ctx !== undefined && ctx.isScrcpyStarted();
  }

  getPort(): number {
    return this.resolvedPort || this.config.port || DEFAULT_SERVER_PORT;
  }
}
