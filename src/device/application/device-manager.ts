/**
 * 设备管理应用服务 — 编排 SO 推送、版本匹配、scrcpy 启停
 *
 * 领域逻辑委托给：
 * - VersionMatcher（版本比较）
 * - SoVersionMatcher（SO 匹配与推送）
 * - ProcessLifecycle（进程生命周期）
 */

import { ChildProcess } from 'child_process';
import { HdcClient } from '../hdc';
import { PortForwardManager } from '../port-forward';
import { IHdcClient, IDeviceManager, IPortForwardManager } from '../interfaces';
import type { ScrcpyConfig, ScreenSize } from '../../shared/types';
import { ScrcpyStartupError } from '../../shared/errors';
import {
  DEFAULT_HDC_PORT,
  DEFAULT_SCRCPY_PORT,
  DEFAULT_SCALE,
  DEFAULT_FRAME_RATE,
  DEFAULT_BIT_RATE_MBPS,
  DEFAULT_SCREEN_ID,
  DEFAULT_I_FRAME_INTERVAL_MS,
  DEFAULT_REPEAT_INTERVAL_MS,
  DEFAULT_IMAGE_SCALE_SIZE,
  SCRPCY_KILL_DELAY_MS,
  SCRPCY_START_RETRY_DELAY_MS,
  AGENT_VERSION_THRESHOLD,
} from '../../constants';
import { VersionMatcher } from '../domain/version';
import { SoVersionMatcher, SCRCPY_SO_LIST, SCRCPY_SEC_SO_LIST } from '../domain/so-matcher';
import { ProcessLifecycle } from '../domain/process-lifecycle';

const CMD_START_SCRCPY = '/system/bin/uitest start-daemon singleness --extension-name %s %s';

export class DeviceManager implements IDeviceManager {
  protected hdc: IHdcClient;
  protected portForward: PortForwardManager;
  private config: Required<Pick<ScrcpyConfig, 'scale' | 'frameRate' | 'bitRate' | 'port' | 'screenId' | 'iFrameInterval' | 'repeatInterval' | 'extensionName' | 'imageScaleSize'>>;

  private scrcpyForwardPort = 0;
  private isUseSecSo = false;
  private scrcpyHdcProcess: ChildProcess | null = null;

  constructor(hdc: IHdcClient, portForward: PortForwardManager, config: ScrcpyConfig) {
    this.hdc = hdc;
    this.portForward = portForward;
    this.config = {
      scale: config.scale ?? DEFAULT_SCALE,
      frameRate: config.frameRate ?? DEFAULT_FRAME_RATE,
      bitRate: config.bitRate ?? DEFAULT_BIT_RATE_MBPS,
      port: config.port ?? DEFAULT_SCRCPY_PORT,
      screenId: config.screenId ?? DEFAULT_SCREEN_ID,
      iFrameInterval: config.iFrameInterval ?? DEFAULT_I_FRAME_INTERVAL_MS,
      repeatInterval: config.repeatInterval ?? DEFAULT_REPEAT_INTERVAL_MS,
      extensionName: config.extensionName || 'libscreen_casting.z.so',
      imageScaleSize: config.imageScaleSize ?? DEFAULT_IMAGE_SCALE_SIZE,
    };
  }

  static fromConfig(config: ScrcpyConfig): DeviceManager {
    const hdc = new HdcClient({
      hdcPath: config.hdcPath || 'hdc',
      ip: config.ip || '127.0.0.1',
      sn: config.sn,
      port: config.hdcPort || DEFAULT_HDC_PORT,
    });
    const portForward = new PortForwardManager(hdc);
    return new DeviceManager(hdc, portForward, config);
  }

  getHdc(): IHdcClient { return this.hdc; }
  getPortForward(): IPortForwardManager { return this.portForward; }
  getIp(): string { return this.hdc.getIp(); }
  getSn(): string { return this.hdc.getSn(); }
  getScreenId(): number { return this.config.screenId; }
  getScale(): number { return this.config.scale; }
  getImageScaleSize(): number { return this.config.imageScaleSize; }

  async isOnline(): Promise<boolean> {
    return this.hdc.isOnline();
  }

  async shell(command: string, timeoutSec?: number): Promise<string> {
    return this.hdc.shell(command, timeoutSec);
  }

  // ── 版本相关（委托给 VersionMatcher） ──

  async getUitestVersion(): Promise<string> {
    return VersionMatcher.getUitestVersion(this.hdc);
  }

  compareVersion(targetVersion: string, deviceVersion: string): number {
    return VersionMatcher.compareVersion(targetVersion, deviceVersion);
  }

  async detectUseSecSo(): Promise<boolean> {
    return VersionMatcher.detectUseSecSo(this.hdc);
  }

  // ── SO 相关（委托给 SoVersionMatcher） ──

  async getDeviceSoMd5(soName?: string): Promise<string> {
    return SoVersionMatcher.getDeviceSoMd5(this.hdc, soName || this.config.extensionName);
  }

  getLocalSoMd5(soName: string): string {
    return SoVersionMatcher.getLocalSoMd5(soName);
  }

  async pushSo(soName: string, devicePath?: string): Promise<boolean> {
    return SoVersionMatcher.pushSo(this.hdc, soName, devicePath);
  }

  // ── 进程生命周期（委托给 ProcessLifecycle） ──

  async ensureBasicUitest(): Promise<void> {
    return ProcessLifecycle.ensureBasicUitest(this.hdc);
  }

  async getScrcpyPids(): Promise<string[]> {
    return ProcessLifecycle.getScrcpyPids(this.hdc, this.config.extensionName, this.config.port);
  }

  async getRecorderPids(): Promise<string[]> {
    return ProcessLifecycle.getRecorderPids(this.hdc);
  }

  async killScrcpy(): Promise<void> {
    return ProcessLifecycle.killScrcpy(this.hdc, this.config.extensionName, this.config.port);
  }

  async killRecorder(): Promise<void> {
    return ProcessLifecycle.killRecorder(this.hdc);
  }

  // ── 应用编排 ──

  buildScrcpyParams(): string {
    const c = this.config;
    return `-scale ${c.scale} -frameRate ${c.frameRate} -bitRate ${c.bitRate * 1024 * 1024} -p ${c.port} -screenId ${c.screenId} -encodeType 0 -iFrameInterval ${c.iFrameInterval} -repeatInterval ${c.repeatInterval}`;
  }

  async startScrcpy(): Promise<void> {
    const existingPids = await this.getScrcpyPids();
    if (existingPids.length > 0) {
      console.log(`[DeviceManager] scrcpy already running (pids: ${existingPids.join(', ')})`);
      return;
    }

    if (this.scrcpyHdcProcess) {
      try { this.scrcpyHdcProcess.kill(); } catch { /* ignore cleanup errors */ }
      this.scrcpyHdcProcess = null;
    }

    await this.killScrcpy();

    const params = this.buildScrcpyParams();
    const cmd = CMD_START_SCRCPY.replace('%s', this.config.extensionName) + ' ' + params;
    console.log(`[DeviceManager] starting scrcpy: ${cmd}`);
    this.scrcpyHdcProcess = this.hdc.spawnShell(cmd);
  }

  async startScrcpyWithForward(): Promise<number> {
    const uitestVersion = await this.getUitestVersion();
    this.isUseSecSo = this.compareVersion('6.0.2.1', uitestVersion) < 0;

    const soList = this.isUseSecSo ? SCRCPY_SEC_SO_LIST : SCRCPY_SO_LIST;

    const deviceMd5 = await this.getDeviceSoMd5();
    console.log(`[DeviceManager] device SO md5: ${deviceMd5}, isUseSecSo: ${this.isUseSecSo}`);

    await this.killScrcpy();
    await new Promise(r => setTimeout(r, SCRPCY_KILL_DELAY_MS));

    await this.startScrcpy();
    await new Promise(r => setTimeout(r, SCRPCY_START_RETRY_DELAY_MS));
    let pids = await this.getScrcpyPids();
    console.log(`[DeviceManager] scrcpy pids after start: ${pids.length}`);

    if (pids.length === 0) {
      let started = false;

      const matchedLocalSo = SoVersionMatcher.findMatchingSo(deviceMd5, this.isUseSecSo);

      if (matchedLocalSo) {
        console.log(`[DeviceManager] device SO matches ${matchedLocalSo}, but process failed to start`);
      }

      for (const soName of soList) {
        if (soName === matchedLocalSo && deviceMd5) continue;
        console.log(`[DeviceManager] trying ${soName}...`);
        await SoVersionMatcher.pushSo(this.hdc, soName);
        await this.startScrcpy();
        await new Promise(r => setTimeout(r, SCRPCY_START_RETRY_DELAY_MS));
        pids = await this.getScrcpyPids();
        if (pids.length > 0) {
          started = true;
          break;
        }
      }

      if (!started) {
        throw new ScrcpyStartupError('no SO version worked');
      }
    }

    let forward: Awaited<ReturnType<PortForwardManager['createTcpForward']>>;
    if (this.isUseSecSo) {
      forward = await this.portForward.createAbstractForward('scrcpy_grpc_socket');
    } else {
      forward = await this.portForward.createTcpForward(this.config.port);
    }

    this.scrcpyForwardPort = forward.localPort;
    return forward.localPort;
  }

  async stopScrcpy(): Promise<void> {
    if (this.scrcpyHdcProcess) {
      try { this.scrcpyHdcProcess.kill(); } catch { /* ignore cleanup errors */ }
      this.scrcpyHdcProcess = null;
    }
    await this.portForward.releaseAll();
    this.scrcpyForwardPort = 0;
  }

  setScrcpyForwardPort(port: number): void { this.scrcpyForwardPort = port; }
  getScrcpyForwardPort(): number { return this.scrcpyForwardPort; }
  getIsUseSecSo(): boolean { return this.isUseSecSo; }

  async getScreenSize(): Promise<ScreenSize> {
    const result = await this.hdc.shell('snapshot_display -f /data/local/tmp/screen.jpeg', 5);
    const match = result.match(/width[: ]+(\d+),\s*height[: ]+(\d+)/);
    if (match) {
      return { width: parseInt(match[1]!, 10), height: parseInt(match[2]!, 10) };
    }
    return { width: 1344, height: 2776 };
  }

  async wakeUp(): Promise<void> {
    await this.hdc.shell('power-shell wakeup', 5);
  }

  async isCloudDevice(): Promise<boolean> {
    const result = await this.hdc.shell('file /system/lib64/libCPHMediaEngine.z.so', 5);
    return !result.includes('No such file or directory');
  }

  async useSecConnect(): Promise<boolean> {
    const result = await this.hdc.shell('cat /data/local/tmp/agent.so | grep -a UITEST_AGENT_LIBRARY ', 5);
    const version = result.trim();
    const match = version.match(/#(\d{1,3}\.\d{1,3}\.\d{1,3})/);
    const deviceLink = match ? match[1]! : '0.0.0';
    console.log(`[DeviceManager] useSecConnect: deviceLink=${deviceLink}, useSec=${VersionMatcher.compareVersion(AGENT_VERSION_THRESHOLD, deviceLink) <= 0}`);
    return VersionMatcher.compareVersion(AGENT_VERSION_THRESHOLD, deviceLink) <= 0;
  }
}

export function sprintf(fmt: string, ...args: (string | number)[]): string {
  let argIdx = 0;
  return fmt.replace(/%[ds]/g, (match) => {
    const val = args[argIdx++];
    return match === '%d' ? String(val) : String(val!);
  });
}
