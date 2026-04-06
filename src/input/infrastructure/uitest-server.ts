/**
 * UiTest 输入控制服务 — 通过 TCP socket 与 uitest agent 通信
 *
 * 协议编解码委托给 uitest-protocol.ts
 * TCP 连接管理委托给 uitest-socket.ts
 */

import * as net from 'net';
import { IDeviceManager, IUitestServer } from '../../device/interfaces';
import { DeviceNotFoundError } from '../../shared/errors';
import {
  AGENT_SERVER_PORT,
  UITEST_SPLIT_VERSION,
  UITEST_SEC_VERSION_THRESHOLD,
  UITEM_START_DELAY_MS,
  SCRPCY_PIDS_TIMEOUT_SEC,
  UITEM_TYPE_CHECK_TIMEOUT_SEC,
  UITEM_START_TIMEOUT_SEC,
  UITEST_LAYOUT_REQUEST_TIMEOUT_MS,
} from '../../constants';
import {
  buildGesturesRequest,
  buildModuleRequest,
  buildCallHypiumRequest,
  buildLayoutFrame,
  parseLayoutResponse,
} from './uitest-protocol';
import { connectSocket, closeSocket, sendRequest, sendLayoutRequest } from './uitest-socket';

const AGENT_NAMES: Record<string, string> = {
  x86_64: 'uitest_agent_x86_1.1.9.so',
  old: 'uitest_agent_1.1.3.so',
  split: 'uitest_agent_1.1.5.so',
  normal: 'uitest_agent_1.1.10.so',
  sec: 'uitest_agent_1.2.2.so',
};

export class UitestServer implements IUitestServer {
  protected device: IDeviceManager;
  private socket: net.Socket | null = null;
  private layoutSocket: net.Socket | null = null;
  private forwardedPort = -1;
  private forwardedLayoutPort = -1;
  private isReady = false;
  private isRunning = false;
  private isUseSec = false;

  constructor(device: IDeviceManager) {
    this.device = device;
  }

  static fromDeviceManager(device: IDeviceManager): UitestServer {
    return new UitestServer(device);
  }

  isUitestRunning(): boolean { return this.isRunning; }

  async start(): Promise<void> {
    if (!await this.device.isOnline()) {
      throw new DeviceNotFoundError(this.device.getSn());
    }

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

  async stop(): Promise<void> {
    this.isRunning = false;
    closeSocket(this.socket);
    this.socket = null;
    closeSocket(this.layoutSocket);
    this.layoutSocket = null;

    const pf = this.device.getPortForward();
    if (pf) {
      if (this.forwardedPort !== -1) {
        await pf.releaseAll();
        this.forwardedPort = -1;
        this.forwardedLayoutPort = -1;
      }
    }

    const pids = await this.getUitestPids();
    for (const pid of pids) {
      await this.device.shell(`kill -9 ${pid}`, 5);
    }
  }

  async touchDown(x: number, y: number): Promise<void> {
    await this.sendTouch('touchDown', x, y);
  }

  async touchUp(x: number, y: number): Promise<void> {
    await this.sendTouch('touchUp', x, y);
  }

  async touchMove(x: number, y: number): Promise<void> {
    await this.sendTouch('touchMove', x, y);
  }

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

  async inputText(x: number, y: number, content: string): Promise<void> {
    const request = buildCallHypiumRequest('Driver.inputText', [[{ x, y }, content]]);
    await this.doSendRequest(request);
  }

  async getLayout(): Promise<string> {
    const params = { api: 'captureLayout' };
    const request = buildModuleRequest('Captures', params);
    return await this.doSendLayoutRequest(request);
  }

  async getScreenSize(): Promise<{ width: number; height: number }> {
    try {
      const request = buildModuleRequest('Display', { api: 'getResolution' });
      const result = await this.doSendRequest(request);
      const resp = JSON.parse(result);
      const r = resp.result;
      if (r && typeof r.width === 'number' && typeof r.height === 'number') {
        return { width: r.width, height: r.height };
      }
      if (r && r.x && r.y) {
        return { width: parseInt(r.x, 10), height: parseInt(r.y, 10) };
      }
    } catch (e) {
      console.warn('[UitestServer] getScreenSize error:', (e as Error).message);
    }
    console.log('[UitestServer] Using default screen size: 1080x2340');
    return { width: 1080, height: 2340 };
  }

  async setRotation(rotation: number): Promise<void> {
    const request = buildCallHypiumRequest('Driver.setDisplayRotation', [rotation]);
    await this.doSendRequest(request);
  }

  async captureScreen(savePath: string, displayId = 0): Promise<void> {
    const params = { api: 'captureScreen', args: { displayId, savePath } };
    const request = buildModuleRequest('Captures', params);
    await this.doSendRequest(request);
  }

  async pressKey(keyCode: number): Promise<boolean> {
    const keyMap: Record<number, string> = {
      3: 'pressHome',
      4: 'pressBack',
    };
    const api = keyMap[keyCode];
    if (api) {
      const request = buildCallHypiumRequest(`Driver.${api}`, []);
      await this.doSendRequest(request);
      return true;
    }
    return false;
  }

  // ── 公开的协议构建方法（供测试使用） ──

  buildGesturesRequest = buildGesturesRequest;
  buildModuleRequest = buildModuleRequest;
  buildCallHypiumRequest = buildCallHypiumRequest;

  // ── 私有方法 ──

  private async startUitest(): Promise<void> {
    const pids = await this.getUitestPids();
    if (pids.length > 0) {
      console.log('[UitestServer] uitest daemon already running');
      return;
    }

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

    const deviceVersionResult = await this.device.shell('cat /data/local/tmp/agent.so | grep -a UITEST_AGENT_LIBRARY ', 5);
    const agentVersion = deviceVersionResult.trim();
    let deviceLink = '0.0.0';
    if (agentVersion.includes('#')) {
      const match = agentVersion.substring(agentVersion.indexOf('#') + 1).match(/(\d{1,3}\.\d{1,3}\.\d{1,3})/);
      deviceLink = match ? match[1]! : '0.0.0';
    }

    const localLink = agentName.substring(agentName.lastIndexOf('_') + 1, agentName.lastIndexOf('.'));
    console.log(`[UitestServer] local agent: ${agentName} (v${localLink}), device agent: v${deviceLink}`);

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
    if (localParts.length > 1 && deviceParts.length > 1 && localParts[1] !== deviceParts[1]) {
      needUpdate = true;
    }

    if (!needUpdate) {
      console.log('[UitestServer] agent SO up to date, skip push');
      return;
    }

    console.log('[UitestServer] updating agent SO...');
    await this.device.pushSo(agentName, '/data/local/tmp/agent.so');
  }

  private async startService(): Promise<void> {
    const pf = this.device.getPortForward();
    if (!pf) {
      throw new Error('PortForwardManager not available');
    }

    let forward;
    if (this.isUseSec) {
      forward = await pf.createAbstractForward('uitest_socket');
    } else {
      forward = await pf.createTcpForward(AGENT_SERVER_PORT);
    }
    this.forwardedPort = forward.localPort;
    this.socket = await connectSocket(this.forwardedPort);

    let layoutForward;
    if (this.isUseSec) {
      layoutForward = await pf.createAbstractForward('uitest_socket');
    } else {
      layoutForward = await pf.createTcpForward(AGENT_SERVER_PORT);
    }
    this.forwardedLayoutPort = layoutForward.localPort;
    this.layoutSocket = await connectSocket(this.forwardedLayoutPort);
  }

  private async sendTouch(api: string, x: number, y: number): Promise<void> {
    if (!this.isRunning) return;
    const request = buildGesturesRequest(api, { x, y });
    await this.doSendRequest(request);
  }

  private async doSendRequest(request: string): Promise<string> {
    const text = await sendRequest(this.socket, this.isReady, request);
    return parseLayoutResponse(text);
  }

  private async doSendLayoutRequest(request: string): Promise<string> {
    const frame = buildLayoutFrame(request);
    const text = await sendLayoutRequest(this.layoutSocket, this.isReady, frame, UITEST_LAYOUT_REQUEST_TIMEOUT_MS);
    return parseLayoutResponse(text);
  }
}
