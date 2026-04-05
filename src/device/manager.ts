import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ChildProcess } from 'child_process';
import { HdcClient } from './hdc';
import { PortForwardManager } from './port-forward';
import { IHdcClient, IDeviceManager, IPortForwardManager } from './interfaces';
import type { ScrcpyConfig, ScreenSize } from '../types';
import { ScrcpyStartupError } from '../errors';
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
  UITEM_PIDS_TIMEOUT_SEC,
  UITEM_START_TIMEOUT_SEC,
  SCRPCY_PIDS_TIMEOUT_SEC,
  FILE_CHECK_TIMEOUT_SEC,
  FILE_DELETE_TIMEOUT_SEC,
  SCRPCY_KILL_DELAY_MS,
  SCRPCY_START_RETRY_DELAY_MS,
  UITEST_SEC_VERSION_THRESHOLD,
  AGENT_VERSION_THRESHOLD,
} from '../constants';

// SO 文件名列表（与原 JAR 一致）
const SCRCPY_SO_LIST = [
  'libscrcpy_server1.z.so',
  'libscrcpy_server2.z.so',
  'libscrcpy_server3.z.so',
  'libscrcpy_server-5.8-20250925.so',
];

const SCRCPY_SEC_SO_LIST = [
  'libscrcpy_server-6.2-20250926.so',
];

// Reserved for future emulator support
const _SCRCPY_EMULATOR_SO = 'libscrcpy_server_emulator.z.so';

// Reserved for future recorder support
const _RECORDER_SO_LIST = [
  'libscrcpy_server1.z.so',
  'libscrcpy_server2.z.so',
  'libscrcpy_server3.z.so',
  'libscrcpy_server-5.8-20250925.so',
];

const _RECORDER_SEC_SO_LIST = [
  'libscrcpy_server-6.2-20250926.so',
];

// Agent names defined in uitest.ts
const _AGENT_NAMES: Record<string, string> = {
  x86_64: 'uitest_agent_x86_1.1.9.so',
  old: 'uitest_agent_1.1.3.so',
  split: 'uitest_agent_1.1.5.so',
  normal: 'uitest_agent_1.1.10.so',
  sec: 'uitest_agent_1.2.2.so',
};

const DEVICE_EXTENSION_PATH = '/data/local/tmp/%s';
// Reserved for future recorder support
const _DEVICE_RECORDER_PATH = '/data/local/tmp/libscreen_recorder.z.so';
const CMD_START_SCRCPY = '/system/bin/uitest start-daemon singleness --extension-name %s %s';
// Reserved for future recorder support
const _CMD_START_RECORDER = '/system/bin/uitest start-daemon singleness --extension-name libscreen_recorder.z.so -p %d -m 1 -screenId %s';
const CMD_UITEST_VERSION = '/system/bin/uitest --version';
// Reserved for future cleanup
const _CMD_DELETE = 'rm /data/local/tmp/%s';

/**
 * 设备管理 — SO 推送、版本匹配、scrcpy/uitest 启停
 */
export class DeviceManager implements IDeviceManager {
  protected hdc: IHdcClient;
  protected portForward: PortForwardManager;
  private config: Required<Pick<ScrcpyConfig, 'scale' | 'frameRate' | 'bitRate' | 'port' | 'screenId' | 'iFrameInterval' | 'repeatInterval' | 'extensionName' | 'imageScaleSize'>>;

  private scrcpyForwardPort = 0;
  private isUseSecSo = false;
  private scrcpyHdcProcess: ChildProcess | null = null;

  /**
   * 依赖注入构造函数 — 接收已创建的依赖
   *
   * @param hdc - HDC 客户端实例
   * @param portForward - 端口转发管理器实例
   * @param config - Scrcpy 配置
   */
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

  /**
   * 向后兼容的工厂方法 — 从配置创建 DeviceManager
   *
   * @param config - Scrcpy 配置（包含 hdcPath, ip, sn, hdcPort 等）
   * @returns 新的 DeviceManager 实例
   */
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

  /**
   * 确保基础 uitest daemon 在运行（extension 需要基础 daemon）
   */
  async ensureBasicUitest(): Promise<void> {
    // 检查是否有基础 uitest（不含 extension-name 的）
    const result = await this.hdc.shell('ps -ef | grep uitest', UITEM_PIDS_TIMEOUT_SEC);
    const hasBasic = result.split(/\r?\n/).some(
      line => line.includes('uitest') && line.includes('singleness') && !line.includes('extension-name') && !line.includes('grep')
    );
    if (hasBasic) {
      console.log('[DeviceManager] basic uitest already running');
      return;
    }
    // 用 shell 脚本启动 nohup uitest
    console.log('[DeviceManager] starting basic uitest...');
    await this.hdc.shell('nohup /system/bin/uitest start-daemon singleness > /dev/null 2>&1 &', UITEM_START_TIMEOUT_SEC);
    await new Promise(r => setTimeout(r, 2000));
  }

  /**
   * 确保 SO 文件存在于设备上
   */
  async getUitestVersion(): Promise<string> {
    const result = await this.hdc.shell(CMD_UITEST_VERSION, 5);
    const lines = result.split(/\r?\n/).filter(l => l.trim());
    return lines.length > 0 ? lines[lines.length - 1]!.trim() : '';
  }

  /**
   * 比较版本号，返回 1 (target > device), -1 (target < device), 0 (equal)
   */
  compareVersion(targetVersion: string, deviceVersion: string): number {
    try {
      const tParts = targetVersion.split('.');
      const dParts = deviceVersion.split('.');
      const minLen = Math.min(tParts.length, dParts.length);
      for (let i = 0; i < minLen; i++) {
        const t = parseInt(tParts[i]!, 10);
        const d = parseInt(dParts[i]!, 10);
        if (t > d) return 1;
        if (t < d) return -1;
      }
      return 0;
    } catch {
      return -1;
    }
  }

  /**
   * 判断是否使用新版 SO (uitest >= 6.0.2.1)
   */
  async detectUseSecSo(): Promise<boolean> {
    const version = await this.getUitestVersion();
    return this.compareVersion(UITEST_SEC_VERSION_THRESHOLD, version) < 0;
  }

  /**
   * 获取设备上 scrcpy SO 的 MD5
   */
  async getDeviceSoMd5(soName?: string): Promise<string> {
    const name = soName || this.config.extensionName;
    const devicePath = sprintf(DEVICE_EXTENSION_PATH, name);
    const result = await this.hdc.shell(`md5sum ${devicePath}`, SCRPCY_PIDS_TIMEOUT_SEC);
    const match = result.match(/^([a-fA-F0-9]+)/);
    return match ? match[1]!.toLowerCase() : '';
  }

  /**
   * 获取本地 SO 文件的 MD5
   */
  getLocalSoMd5(soName: string): string {
    const soPath = this.getSoAssetPath(soName);
    if (!fs.existsSync(soPath)) return '';
    const content = fs.readFileSync(soPath);
    return crypto.createHash('md5').update(content).digest('hex');
  }

  private getSoAssetPath(soName: string): string {
    return path.join(__dirname, '..', 'assets', 'so', soName);
  }

  /**
   * 获取 scrcpy server PIDs（只获取带 extension-name 的）
   * 与 Java 版一致的匹配逻辑：单次 ps + grep，字符串匹配即可
   */
  async getScrcpyPids(): Promise<string[]> {
    const result = await this.hdc.shell('"ps -ef | grep singleness"', SCRPCY_PIDS_TIMEOUT_SEC);
    const pids: string[] = [];

    for (const line of result.split(/\r?\n/)) {
      if (
        line.includes('singleness') &&
        (line.includes(this.config.extensionName) || line.includes('-p ' + this.config.port)) &&
        line.includes('extension-name') &&
        !line.includes('grep')
      ) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          pids.push(parts[1]!);
        }
      }
    }
    return pids;
  }

  /**
   * 获取 recorder PIDs
   */
  async getRecorderPids(): Promise<string[]> {
    const result = await this.hdc.shell('ps -ef | grep singleness', SCRPCY_PIDS_TIMEOUT_SEC);
    const pids: string[] = [];
    for (const line of result.split(/\r?\n/)) {
      if (
        line.includes('singleness') &&
        !line.includes('grep') &&
        !line.includes('agent.so')
      ) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2) pids.push(parts[1]!);
      }
    }
    return pids;
  }

  /**
   * 杀死 scrcpy server 进程
   */
  async killScrcpy(): Promise<void> {
    const pids = await this.getScrcpyPids();
    for (const pid of pids) {
      await this.hdc.shell(`kill -9 ${pid}`, 5);
    }
  }

  /**
   * 杀死 recorder 进程
   */
  async killRecorder(): Promise<void> {
    const pids = await this.getRecorderPids();
    for (const pid of pids) {
      await this.hdc.shell(`kill -9 ${pid}`, 5);
    }
  }

  /**
   * 推送 SO 文件到设备
   */
  async pushSo(soName: string, devicePath?: string): Promise<boolean> {
    const srcPath = this.getSoAssetPath(soName);
    if (!fs.existsSync(srcPath)) {
      console.error(`[DeviceManager] SO not found: ${srcPath}`);
      return false;
    }
    const dest = devicePath || sprintf(DEVICE_EXTENSION_PATH, soName);

    // 检查设备上是否已有正确文件
    const localMd5 = this.getLocalSoMd5(soName);
    const checkResult = await this.hdc.shell(`file ${dest}`, FILE_CHECK_TIMEOUT_SEC);
    if (checkResult.includes('ELF')) {
      // SO 文件存在且是 ELF，检查 MD5
      const md5Result = await this.hdc.shell(`md5sum ${dest}`, 5);
      const match = md5Result.match(/^([a-fA-F0-9]+)/);
      if (match && match[1]!.toLowerCase() === localMd5) {
        console.log(`[DeviceManager] ${soName} already up-to-date on device`);
        return true;
      }
    }

    // 删除旧文件/目录
    await this.hdc.shell(`rm -rf ${dest}`, FILE_DELETE_TIMEOUT_SEC);

    // 使用 rename 方式推送（hdc file send 直接发送 .so 可能创建目录）
    const tmpPath = '/data/local/tmp/_scrcpy_tmp.so';
    await this.hdc.pushFile(srcPath, tmpPath);
    await this.hdc.shell(`mv ${tmpPath} ${dest}`, 5);
    console.log(`[DeviceManager] push ${soName} -> ${dest}`);
    return true;
  }

  /**
   * 构建启动参数字符串
   */
  buildScrcpyParams(): string {
    const c = this.config;
    return `-scale ${c.scale} -frameRate ${c.frameRate} -bitRate ${c.bitRate * 1024 * 1024} -p ${c.port} -screenId ${c.screenId} -encodeType 0 -iFrameInterval ${c.iFrameInterval} -repeatInterval ${c.repeatInterval}`;
  }

  /**
   * 启动 scrcpy server（保持 hdc 进程存活以维持设备端 scrcpy 进程）
   */
  async startScrcpy(): Promise<void> {
    // 如果 scrcpy 已经在运行，跳过
    const existingPids = await this.getScrcpyPids();
    if (existingPids.length > 0) {
      console.log(`[DeviceManager] scrcpy already running (pids: ${existingPids.join(', ')})`);
      return;
    }

    // Kill old hdc process if any
    if (this.scrcpyHdcProcess) {
      try { this.scrcpyHdcProcess.kill(); } catch { /* ignore cleanup errors */ }
      this.scrcpyHdcProcess = null;
    }

    // 清理设备上残留的旧 scrcpy 进程
    await this.killScrcpy();

    const params = this.buildScrcpyParams();
    const cmd = sprintf(CMD_START_SCRCPY, this.config.extensionName, params);
    console.log(`[DeviceManager] starting scrcpy: ${cmd}`);
    this.scrcpyHdcProcess = this.hdc.spawnShell(cmd);
  }

  /**
   * 启动 scrcpy 并创建端口转发，返回本地转发端口
   * 完整流程：版本检测 → SO 匹配 → 进程启动 → 端口转发
   */
  async startScrcpyWithForward(): Promise<number> {
    const uitestVersion = await this.getUitestVersion();
    this.isUseSecSo = this.compareVersion(UITEST_SEC_VERSION_THRESHOLD, uitestVersion) < 0;

    const soList = this.isUseSecSo ? SCRCPY_SEC_SO_LIST : SCRCPY_SO_LIST;

    // 检查设备上 SO 的 MD5，与本地 SO 匹配
    const deviceMd5 = await this.getDeviceSoMd5();
    console.log(`[DeviceManager] device SO md5: ${deviceMd5}, isUseSecSo: ${this.isUseSecSo}`);

    // 杀掉残留的 scrcpy 进程，确保干净启动
    await this.killScrcpy();
    await new Promise(r => setTimeout(r, SCRPCY_KILL_DELAY_MS));

    // 尝试直接启动（设备上可能已有正确版本的 SO）
    await this.startScrcpy();
    await new Promise(r => setTimeout(r, SCRPCY_START_RETRY_DELAY_MS));
    let pids = await this.getScrcpyPids();
    console.log(`[DeviceManager] scrcpy pids after start: ${pids.length}`);

    if (pids.length === 0) {
      // 直接启动失败，尝试匹配 SO 版本并推送
      let started = false;

      // 检查本地 SO 的 MD5 是否匹配设备
      let matchedLocalSo = '';
      for (const soName of soList) {
        const localMd5 = this.getLocalSoMd5(soName);
        if (localMd5 === deviceMd5) {
          matchedLocalSo = soName;
          break;
        }
      }

      if (matchedLocalSo) {
        console.log(`[DeviceManager] device SO matches ${matchedLocalSo}, but process failed to start`);
      }

      // 尝试每个版本的 SO
      for (const soName of soList) {
        if (soName === matchedLocalSo && deviceMd5) continue;
        console.log(`[DeviceManager] trying ${soName}...`);
        const assetSoName = soName.startsWith('libscrcpy_server') ? soName : soName;
        await this.pushSo(assetSoName);
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

    // 创建端口转发
    let forward: Awaited<ReturnType<PortForwardManager['createTcpForward']>>;
    if (this.isUseSecSo) {
      forward = await this.portForward.createAbstractForward('scrcpy_grpc_socket');
    } else {
      forward = await this.portForward.createTcpForward(this.config.port);
    }

    this.scrcpyForwardPort = forward.localPort;
    return forward.localPort;
  }

  /**
   * 停止 scrcpy 并清理
   */
  async stopScrcpy(): Promise<void> {
    // Kill the hdc process to terminate scrcpy on device
    if (this.scrcpyHdcProcess) {
      try { this.scrcpyHdcProcess.kill(); } catch { /* ignore cleanup errors */ }
      this.scrcpyHdcProcess = null;
    }
    await this.portForward.releaseAll();
    this.scrcpyForwardPort = 0;
  }

  setScrcpyForwardPort(port: number): void { this.scrcpyForwardPort = port; }

  getScrcpyForwardPort(): number {
    return this.scrcpyForwardPort;
  }

  getIsUseSecSo(): boolean {
    return this.isUseSecSo;
  }

  /**
   * 获取屏幕尺寸
   */
  async getScreenSize(): Promise<ScreenSize> {
    const result = await this.hdc.shell('snapshot_display -f /data/local/tmp/screen.jpeg', 5);
    // 匹配 "width 1234, height 5678" 或 "width: 1234, height: 5678"
    const match = result.match(/width[: ]+(\d+),\s*height[: ]+(\d+)/);
    if (match) {
      return { width: parseInt(match[1]!, 10), height: parseInt(match[2]!, 10) };
    }
    return { width: 1344, height: 2776 }; // fallback
  }

  /**
   * 唤醒屏幕
   */
  async wakeUp(): Promise<void> {
    await this.hdc.shell('power-shell wakeup', 5);
  }

  /**
   * 判断是否为云设备
   */
  async isCloudDevice(): Promise<boolean> {
    const result = await this.hdc.shell('file /system/lib64/libCPHMediaEngine.z.so', 5);
    return !result.includes('No such file or directory');
  }

  /**
   * 判断是否使用新版 uitest 连接方式
   */
  async useSecConnect(): Promise<boolean> {
    const result = await this.hdc.shell('cat /data/local/tmp/agent.so | grep -a UITEST_AGENT_LIBRARY ', 5);
    const version = result.trim();
    // 匹配 # 后面的版本号，如 UITEST_AGENT_LIBRARY@v0.0.0#1.2.2 中的 1.2.2
    const match = version.match(/#(\d{1,3}\.\d{1,3}\.\d{1,3})/);
    const deviceLink = match ? match[1]! : '0.0.0';
    console.log(`[DeviceManager] useSecConnect: deviceLink=${deviceLink}, useSec=${this.compareVersion(AGENT_VERSION_THRESHOLD, deviceLink) <= 0}`);
    return this.compareVersion(AGENT_VERSION_THRESHOLD, deviceLink) <= 0;
  }
}

export function sprintf(fmt: string, ...args: (string | number)[]): string {
  let argIdx = 0;
  return fmt.replace(/%[ds]/g, (match) => {
    const val = args[argIdx++];
    return match === '%d' ? String(val) : String(val!);
  });
}

// Re-export types for backward compatibility
export type { ScrcpyConfig, ScreenSize } from '../types';

// Re-export DeviceFactory
export { DeviceFactory } from './factory';
