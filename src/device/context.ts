import { WebSocket } from 'ws';
import { IDeviceManager, IUitestServer, IScrcpyStream } from './interfaces';
import { DirectScrcpyStream } from '../capture/direct-scrcpy';
import {
  UINPUT_MONITOR_TIMEOUT_SEC,
  UINPUT_TOUCH_TIMEOUT_SEC,
  UITEM_START_DELAY_MS,
  UITEST_CAPTURE_INTERVAL_MS,
} from '../constants';

/**
 * 设备上下文 — 管理单个设备的所有投屏和输入资源
 */
export class DeviceContext {
  public manager: IDeviceManager;
  public uitest: IUitestServer;
  scrcpyStream: IScrcpyStream | null = null;
  private activeCastType: 'screen' | 'uitest' | null = null;
  private clients = new Set<string>();
  private wsClients = new Map<string, WebSocket>();
  private scrcpyStarted = false;
  private startLock: Promise<void> | null = null;
  private persistent: boolean = false;  // 持久化标记：无 WS 客户端时也保持投屏

  /**
   * 依赖注入构造函数 — 接收已创建的依赖
   *
   * @param manager - 设备管理器实例
   * @param uitest - UiTest 服务实例
   * @param persistent - 是否持久化投屏（无客户端时保持流）
   * @param streamFactory - 可选的流工厂函数
   */
  constructor(
    manager: IDeviceManager,
    uitest: IUitestServer,
    persistent: boolean = false,
    private streamFactory?: (manager: IDeviceManager) => IScrcpyStream,
  ) {
    this.manager = manager;
    this.uitest = uitest;
    this.persistent = persistent;
  }

  /**
   * 创建 Scrcpy 视频流实例
   */
  private createStream(): IScrcpyStream {
    if (this.streamFactory) {
      return this.streamFactory(this.manager);
    }
    return new DirectScrcpyStream(this.manager);
  }

  /**
   * 向后兼容的工厂方法 — 从配置创建 DeviceContext
   *
   * @param config - Scrcpy 配置
   * @returns 新的 DeviceContext 实例
   */
  static fromConfig(config: { sn: string; persistent?: boolean } & Record<string, unknown>): DeviceContext {
    const { DeviceManager } = require('./manager');
    const { UitestServer } = require('../../input/uitest');
    const manager = DeviceManager.fromConfig(config as any);
    const uitest = UitestServer.fromDeviceManager(manager);
    return new DeviceContext(manager, uitest, config.persistent || false);
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

  isScrcpyStarted(): boolean {
    return this.scrcpyStarted;
  }

  isPersistent(): boolean {
    return this.persistent;
  }


  /**
   * 启动投屏（编程式 API，无需 WS 客户端）
   * 用于 server.startDevice() 调用
   */
  async startScreenCast(): Promise<void>;
  /**
   * 启动投屏（WS 客户端触发）
   */
  async startScreenCast(ws: WebSocket, clientId?: string): Promise<void>;
  async startScreenCast(ws?: WebSocket, clientId?: string): Promise<void> {
    if (clientId && ws) {
      this.wsClients.set(clientId, ws);
      console.log(`[DeviceContext] Client ${clientId} added to wsClients, total: ${this.wsClients.size}`);
    }

    if (this.scrcpyStarted) {
      console.log(`[DeviceContext] scrcpy already running, client ${clientId || 'programmatic'} reusing existing stream`);
      // 向新连接的客户端发送 screenConfig
      if (ws && ws.readyState === WebSocket.OPEN) {
        const scale = this.manager.getScale();
        ws.send(JSON.stringify({ type: 'screenConfig', scale }));
        console.log(`[DeviceContext] Sent screenConfig to client ${clientId || 'ws'}`);
      }
      return;
    }

    // 等待正在进行的启动完成
    if (this.startLock) {
      console.log(`[DeviceContext] client ${clientId} waiting for ongoing scrcpy start`);
      await this.startLock;
      // 等待完成后，如果流已就绪，发送 screenConfig
      if (this.scrcpyStarted && ws && ws.readyState === WebSocket.OPEN) {
        const scale = this.manager.getScale();
        ws.send(JSON.stringify({ type: 'screenConfig', scale }));
        console.log(`[DeviceContext] Sent screenConfig to client ${clientId || 'ws'} after wait`);
      }
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

      this.scrcpyStream = this.createStream();
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
          for (const [_id, clientWs] of this.wsClients) {
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

    await this.manager.shell('uinput -M -m 100 100 120 100 1000 --trace', UINPUT_MONITOR_TIMEOUT_SEC);
    await new Promise(r => setTimeout(r, UITEM_START_DELAY_MS));
    await this.manager.shell('uinput -T -c 0 0', UINPUT_TOUCH_TIMEOUT_SEC);

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
    }, UITEST_CAPTURE_INTERVAL_MS); // 2 FPS

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
    for (const [_id, ws] of this.wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    this.wsClients.clear();
  }
}
