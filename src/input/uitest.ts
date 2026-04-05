import * as net from 'net';
import { DeviceManager } from '../device/manager';
import { DeviceNotFoundError } from '../errors';
import {
  AGENT_SERVER_PORT,
  UITEST_SPLIT_VERSION,
  UITEST_SEC_VERSION_THRESHOLD,
  UITEM_START_DELAY_MS,
  SCRPCY_PIDS_TIMEOUT_SEC,
  UITEM_TYPE_CHECK_TIMEOUT_SEC,
  UITEM_START_TIMEOUT_SEC,
  UITEST_LAYOUT_REQUEST_TIMEOUT_MS,
  AGENT_VERSION_THRESHOLD,
} from '../constants';

const AGENT_NAMES: Record<string, string> = {
  x86_64: 'uitest_agent_x86_1.1.9.so',
  old: 'uitest_agent_1.1.3.so',
  split: 'uitest_agent_1.1.5.so',
  normal: 'uitest_agent_1.1.10.so',
  sec: 'uitest_agent_1.2.2.so',
};

const HEAD = Buffer.from('_uitestkit_rpc_message_head_', 'utf-8');
const TAIL = Buffer.from('_uitestkit_rpc_message_tail_', 'utf-8');
const AUX_MAGIC = 1145141919;

/**
 * UiTest 输入控制 — 通过 TCP socket 与 uitest agent 通信
 */
export class UitestServer {
  private device: DeviceManager;
  private socket: net.Socket | null = null;
  private layoutSocket: net.Socket | null = null;
  private forwardedPort = -1;
  private forwardedLayoutPort = -1;
  private isReady = false;
  private isRunning = false;
  private isUseSec = false;

  constructor(device: DeviceManager) {
    this.device = device;
  }

  isUitestRunning(): boolean { return this.isRunning; }

  /**
   * 初始化并启动 uitest 服务
   */
  async start(): Promise<void> {
    if (!await this.device.isOnline()) {
      throw new DeviceNotFoundError(this.device.getSn());
    }

    // 如果已经在运行，先停止
    if (this.isRunning) {
      await this.stop();
    }

    await this.initSoResource();
    await this.startUitest();
    this.isUseSec = await this.device.useSecConnect();
    await this.startService();
    this.isReady = true;
    this.isRunning = true;
  }

  /**
   * 停止 uitest 服务
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    this.closeSocket(this.socket);
    this.socket = null;
    this.closeSocket(this.layoutSocket);
    this.layoutSocket = null;

    const pf = this.device.getPortForward();
    // 尝试移除端口转发（两种模式都尝试）
    if (this.forwardedPort !== -1) {
      await pf.releaseAll();
      this.forwardedPort = -1;
      this.forwardedLayoutPort = -1;
    }

    // 清理设备上的 uitest agent 进程
    const pids = await this.getUitestPids();
    for (const pid of pids) {
      await this.device.shell(`kill -9 ${pid}`, 5);
    }
  }

  /**
   * 发送触摸事件
   */
  async touchDown(x: number, y: number): Promise<void> {
    await this.sendTouch('touchDown', x, y);
  }

  async touchUp(x: number, y: number): Promise<void> {
    await this.sendTouch('touchUp', x, y);
  }

  async touchMove(x: number, y: number): Promise<void> {
    await this.sendTouch('touchMove', x, y);
  }

  /**
   * 鼠标事件
   */
  async mouseDown(type: 'mouseLeft' | 'mouseMiddle' | 'mouseRight', x: number, y: number): Promise<void> {
    const apiMap: Record<string, string> = {
      mouseLeft: 'ButtonLeftDown',
      mouseMiddle: 'ButtonMiddleDown',
      mouseRight: 'ButtonRightDown',
    };
    await this.sendTouch(apiMap[type]!, x, y);
  }

  async mouseUp(type: 'mouseLeft' | 'mouseMiddle' | 'mouseRight', x: number, y: number): Promise<void> {
    const apiMap: Record<string, string> = {
      mouseLeft: 'ButtonLeftUp',
      mouseMiddle: 'ButtonMiddleUp',
      mouseRight: 'ButtonRightUp',
    };
    await this.sendTouch(apiMap[type]!, x, y);
  }

  async mouseMove(type: 'mouseLeft' | 'mouseMiddle' | 'mouseRight' | null, x: number, y: number): Promise<void> {
    const apiMap: Record<string, string> = {
      mouseLeft: 'ButtonLeftMove',
      mouseMiddle: 'ButtonMiddleMove',
      mouseRight: 'ButtonRightMove',
    };
    await this.sendTouch(type ? apiMap[type]! : 'MouseMove', x, y);
  }

  async mouseWheelUp(x: number, y: number): Promise<void> {
    await this.sendTouch('AxisUp', x, y);
  }

  async mouseWheelDown(x: number, y: number): Promise<void> {
    await this.sendTouch('AxisDown', x, y);
  }

  async mouseWheelStop(x: number, y: number): Promise<void> {
    await this.sendTouch('AxisStop', x, y);
  }

  /**
   * 输入文本
   */
  async inputText(x: number, y: number, content: string): Promise<void> {
    const request = this.buildCallHypiumRequest('Driver.inputText', [[{ x, y }, content]]);
    await this.sendRequest(request);
  }

  /**
   * 获取 UI 布局
   */
  async getLayout(): Promise<string> {
    const params = { api: 'captureLayout' };
    const request = this.buildModuleRequest('Captures', params);
    return await this.sendLayoutRequest(request);
  }

  /**
   * 获取屏幕尺寸
   */
  async getScreenSize(): Promise<{ width: number; height: number }> {
    try {
      // 使用正确的 API 调用格式
      const request = this.buildModuleRequest('Display', { api: 'getResolution' });
      const result = await this.sendRequest(request);
      const resp = JSON.parse(result);
      const r = resp.result;
      if (r && typeof r.width === 'number' && typeof r.height === 'number') {
        return { width: r.width, height: r.height };
      }
      // 尝试其他格式
      if (r && r.x && r.y) {
        return { width: parseInt(r.x, 10), height: parseInt(r.y, 10) };
      }
    } catch (e) {
      console.warn('[UitestServer] getScreenSize error:', (e as Error).message);
    }
    // Return default size for common HarmonyOS devices
    console.log('[UitestServer] Using default screen size: 1080x2340');
    return { width: 1080, height: 2340 };
  }

  /**
   * 设置屏幕方向
   */
  async setRotation(rotation: number): Promise<void> {
    const request = this.buildCallHypiumRequest('Driver.setDisplayRotation', [rotation]);
    await this.sendRequest(request);
  }

  /**
   * 截图
   */
  async captureScreen(savePath: string, displayId = 0): Promise<void> {
    const params = { api: 'captureScreen', args: { displayId, savePath } };
    const request = this.buildModuleRequest('Captures', params);
    await this.sendRequest(request);
  }

  /**
   * 发送按键事件（通过 uitest）
   */
  async pressKey(keyCode: number): Promise<boolean> {
    // HarmonyOS 键码映射 — 仅 HOME/BACK 通过 uitest API
    const keyMap: Record<number, string> = {
      3: 'pressHome',
      4: 'pressBack',
    };
    const api = keyMap[keyCode];
    if (api) {
      const request = this.buildCallHypiumRequest(`Driver.${api}`, []);
      await this.sendRequest(request);
      return true;
    }
    return false;
  }

  // ========== Private methods ==========

  private async startUitest(): Promise<void> {
    // 检查基础 uitest daemon 是否已在运行
    const pids = await this.getUitestPids();
    if (pids.length > 0) {
      console.log('[UitestServer] uitest daemon already running');
      return;
    }

    // 启动新的基础 uitest daemon
    await this.device.shell('/system/bin/uitest start-daemon singleness &', UITEM_START_TIMEOUT_SEC);
    await new Promise(r => setTimeout(r, UITEM_START_DELAY_MS));

    const pids2 = await this.getUitestPids();
    if (pids2.length === 0) {
      console.warn('[UitestServer] start uitest failed');
    }
  }

  private async getUitestPids(): Promise<string[]> {
    const result = await this.device.shell('ps -ef | grep singleness', SCRPCY_PIDS_TIMEOUT_SEC);
    const pids: string[] = [];
    for (const line of result.split(/\r?\n/)) {
      if (
        line.includes('singleness') &&
        line.includes('uitest') &&
        !line.includes('extension-name') &&
        !line.includes('grep')
      ) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2) pids.push(parts[1]!);
      }
    }
    return pids;
  }

  private async initSoResource(): Promise<void> {
    // 检测设备类型和 uitest 版本来选择 agent SO
    const typeResult = await this.device.shell('file /system/bin/uitest', UITEM_TYPE_CHECK_TIMEOUT_SEC);
    const versionResult = await this.device.getUitestVersion();

    let agentName: string;
    if (typeResult.includes('x86_64')) {
      agentName = AGENT_NAMES.x86_64;
    } else if (this.device.compareVersion('5.1.1.2', versionResult) >= 0) {
      agentName = AGENT_NAMES.old;
    } else if (this.device.compareVersion(UITEST_SPLIT_VERSION, versionResult) === 0) {
      agentName = AGENT_NAMES.split;
    } else if (this.device.compareVersion(UITEST_SEC_VERSION_THRESHOLD, versionResult) >= 0) {
      agentName = AGENT_NAMES.normal;
    } else {
      agentName = AGENT_NAMES.sec;
    }

    // 检查设备上 agent 版本，避免不必要的推送
    const deviceVersionResult = await this.device.shell('cat /data/local/tmp/agent.so | grep -a UITEST_AGENT_LIBRARY ', 5);
    const agentVersion = deviceVersionResult.trim();
    let deviceLink = '0.0.0';
    if (agentVersion.includes('#')) {
      const match = agentVersion.substring(agentVersion.indexOf('#') + 1).match(/(\d{1,3}\.\d{1,3}\.\d{1,3})/);
      deviceLink = match ? match[1]! : '0.0.0';
    }

    // 从 agentName 中提取本地版本号
    const localLink = agentName.substring(agentName.lastIndexOf('_') + 1, agentName.lastIndexOf('.'));
    console.log(`[UitestServer] local agent: ${agentName} (v${localLink}), device agent: v${deviceLink}`);

    // 比较版本：本地 > 设备时需要更新
    const localParts = localLink.split('.');
    const deviceParts = deviceLink.split('.');
    const minLen = Math.min(localParts.length, deviceParts.length);
    let needUpdate = false;
    for (let i = 0; i < minLen; i++) {
      const l = parseInt(localParts[i]!, 10);
      const d = parseInt(deviceParts[i]!, 10);
      if (l > d) { needUpdate = true; break; }
      if (l < d) { break; }
    }
    // 次版本号不同也需要更新
    if (localParts.length > 1 && deviceParts.length > 1 && localParts[1] !== deviceParts[1]) {
      needUpdate = true;
    }

    if (!needUpdate) {
      console.log('[UitestServer] agent SO up to date, skip push');
      return;
    }

    // 推送 agent SO
    console.log('[UitestServer] updating agent SO...');
    await this.device.pushSo(agentName, '/data/local/tmp/agent.so');
  }

  private async startService(): Promise<void> {
    const pf = this.device.getPortForward();

    // 创建数据端口转发
    let forward;
    if (this.isUseSec) {
      forward = await pf.createAbstractForward('uitest_socket');
    } else {
      forward = await pf.createTcpForward(AGENT_SERVER_PORT);
    }
    this.forwardedPort = forward.localPort;
    this.socket = await this.connectSocket(this.forwardedPort);

    // 创建布局端口转发
    let layoutForward;
    if (this.isUseSec) {
      layoutForward = await pf.createAbstractForward('uitest_socket');
    } else {
      layoutForward = await pf.createTcpForward(AGENT_SERVER_PORT);
    }
    this.forwardedLayoutPort = layoutForward.localPort;
    this.layoutSocket = await this.connectSocket(this.forwardedLayoutPort);
  }

  private async allocatePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const port = server.address() as { port: number };
        server.close(() => resolve(port.port));
      });
      server.on('error', reject);
    });
  }

  private connectSocket(port: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      sock.setNoDelay(true);
      sock.connect(port, '127.0.0.1', () => resolve(sock));
      sock.on('error', reject);
    });
  }

  private closeSocket(sock: net.Socket | null): void {
    if (sock) {
      try { sock.destroy(); } catch {}
    }
  }

  private async sendTouch(api: string, x: number, y: number): Promise<void> {
    if (!this.isRunning) return;
    const request = this.buildGesturesRequest(api, { x, y });
    await this.sendRequest(request);
  }

  buildGesturesRequest(api: string, args: Record<string, number>): string {
    return JSON.stringify({
      module: 'com.ohos.devicetest.hypiumApiHelper',
      method: 'Gestures',
      params: { api, args },
    });
  }

  buildModuleRequest(method: string, params: Record<string, unknown>): string {
    return JSON.stringify({
      module: 'com.ohos.devicetest.hypiumApiHelper',
      method,
      params,
    });
  }

  buildCallHypiumRequest(api: string, args: unknown): string {
    return JSON.stringify({
      module: 'com.ohos.devicetest.hypiumApiHelper',
      method: 'callHypiumApi',
      params: { api, args, this: 'Driver#0' },
    });
  }

  private sendRequest(request: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isReady) {
        reject(new Error('Uitest not ready'));
        return;
      }
      const data = Buffer.from(request, 'utf-8');

      const onData = (buf: Buffer) => {
        const text = buf.toString('utf-8');
        this.socket!.off('data', onData);
        resolve(text);
      };

      const onError = (err: Error) => {
        this.socket!.off('data', onData);
        reject(err);
      };

      this.socket.once('data', onData);
      this.socket.once('error', onError);
      this.socket.write(data);
    });
  }

  private sendLayoutRequest(request: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.layoutSocket || !this.isReady) {
        reject(new Error('Uitest not ready'));
        return;
      }

      const body = Buffer.from(request, 'utf-8');
      const header = Buffer.alloc(4 + 4);
      header.writeUInt32BE(AUX_MAGIC, 0);
      header.writeUInt32BE(body.length, 4);
      const frame = Buffer.concat([HEAD, header, body, TAIL]);

      let chunks: Buffer[] = [];
      let totalLen = 0;
      let found = false;

      const onData = (buf: Buffer) => {
        chunks.push(buf);
        totalLen += buf.length;
        const combined = Buffer.concat(chunks);
        const text = combined.toString('utf-8');

        if (text.includes('_uitestkit_rpc_message_tail_')) {
          found = true;
          this.layoutSocket!.off('data', onData);
          // 提取 JSON 部分
          const startIdx = text.indexOf('{"result');
          const endIdx = text.indexOf('_uitestkit_rpc_message_tail_');
          if (startIdx >= 0 && endIdx > startIdx) {
            const jsonStr = text.substring(startIdx, endIdx);
            try {
              const resp = JSON.parse(jsonStr);
              // Handle different response formats
              if (resp.result) {
                const resultStr = typeof resp.result === 'string' ? resp.result : JSON.stringify(resp.result);
                resolve(resultStr);
              } else {
                resolve(jsonStr);
              }
            } catch {
              resolve(text);
            }
          } else {
            resolve(text);
          }
        }
      };

      const onError = (err: Error) => {
        this.layoutSocket!.off('data', onData);
        reject(err);
      };

      this.layoutSocket.on('data', onData);
      this.layoutSocket.once('error', onError);
      this.layoutSocket.write(frame);

      // 超时保护
      setTimeout(() => {
        if (!found) {
          this.layoutSocket!.off('data', onData);
          resolve('');
        }
      }, UITEST_LAYOUT_REQUEST_TIMEOUT_MS);
    });
  }
}
