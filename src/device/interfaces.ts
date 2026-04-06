import { ChildProcess } from 'child_process';
import type { ScrcpyConfig } from '../shared/types';

/**
 * HDC 客户端接口 — HarmonyOS Device Connector 抽象
 */
export interface IHdcClient {
  /** 检查设备是否在线 */
  isOnline(): Promise<boolean>;

  /** 执行 shell 命令 */
  shell(command: string, timeout?: number): Promise<string>;

  /** 启动持久化 shell 命令 */
  spawnShell(command: string): ChildProcess;

  /** 推送文件到设备 */
  pushFile(localPath: string, remotePath: string): Promise<string>;

  /** 从设备拉取文件 */
  pullFile(remotePath: string, localPath: string): Promise<string>;

  /** 创建端口转发 */
  createForward(localPort: number, remotePort: number): Promise<string>;

  /** 创建抽象 socket 转发 */
  createAbstractForward(localPort: number, abstractSocket: string): Promise<string>;

  /** 移除端口转发 */
  removeForward(localPort: number, remotePort: number): Promise<string>;

  /** 移除抽象 socket 转发 */
  removeAbstractForward(localPort: number, abstractSocket: string): Promise<string>;

  /** 获取设备序列号 */
  getSn(): string;

  /** 获取设备 IP */
  getIp(): string;
}

/**
 * 端口转发结果
 */
export interface ForwardedPort {
  /** 本地端口号 */
  localPort: number;
  /** 释放端口转发 */
  release(): Promise<void>;
}

/**
 * 端口转发管理器接口
 */
export interface IPortForwardManager {
  /** 创建 TCP 端口转发 */
  createTcpForward(remotePort: number): Promise<ForwardedPort>;

  /** 创建抽象 socket 转发 */
  createAbstractForward(abstractSocket: string): Promise<ForwardedPort>;

  /** 释放所有端口转发 */
  releaseAll(): Promise<void>;
}

/**
 * 设备管理器接口 — 设备状态和投屏管理抽象
 */
export interface IDeviceManager {
  /** 检查设备是否在线 */
  isOnline(): Promise<boolean>;

  /** 执行 shell 命令 */
  shell(command: string, timeout?: number): Promise<string>;

  /** 获取视频缩放比例 */
  getScale(): number;

  /** 获取 HDC 客户端 */
  getHdc(): IHdcClient;

  /** 获取设备序列号 */
  getSn(): string;

  /** 获取设备 IP */
  getIp(): string;

  /** 获取屏幕 ID */
  getScreenId(): number;

  /** 启动 scrcpy 并创建端口转发，返回本地端口 */
  startScrcpyWithForward(): Promise<number>;

  /** 停止 scrcpy 并清理资源 */
  stopScrcpy(): Promise<void>;

  /** 获取 scrcpy 转发端口 */
  getScrcpyForwardPort(): number;

  /** 设置 scrcpy 转发端口 */
  setScrcpyForwardPort(port: number): void;

  /** 获取屏幕尺寸 */
  getScreenSize(): Promise<{ width: number; height: number }>;

  /** 比较版本号 */
  compareVersion(target: string, device: string): number;

  /** 获取端口转发管理器 */
  getPortForward(): IPortForwardManager | undefined;

  /** 检查是否使用安全连接（agent >= 1.2.0） */
  useSecConnect(): Promise<boolean>;

  /** 推送 SO 文件到设备 */
  pushSo(soName: string, devicePath?: string): Promise<boolean>;

  /** 获取设备上 uitest 版本 */
  getUitestVersion(): Promise<string>;

  /** 确保基础 uitest daemon 在运行 */
  ensureBasicUitest(): Promise<void>;

  /** 获取设备上 scrcpy server PIDs */
  getScrcpyPids(): Promise<string[]>;

  /** 杀死设备上的 scrcpy server 进程 */
  killScrcpy(): Promise<void>;

  /** 唤醒设备屏幕 */
  wakeUp(): Promise<void>;

  /** 判断是否为云设备 */
  isCloudDevice(): Promise<boolean>;

  /** 获取图像缩放尺寸 */
  getImageScaleSize(): number;

  /** 判断是否使用新版 SO */
  getIsUseSecSo(): boolean;

  /** 启动 scrcpy（不含端口转发） */
  startScrcpy(): Promise<void>;
}

/**
 * UiTest 服务接口 — 输入控制抽象
 */
export interface IUitestServer {
  /** 检查 uitest 是否运行中 */
  isUitestRunning(): boolean;

  /** 启动 uitest 服务 */
  start(): Promise<void>;

  /** 停止 uitest 服务 */
  stop(): Promise<void>;

  /** 发送按键事件（返回是否处理） */
  pressKey(keyCode: number): Promise<boolean>;

  /** 触摸按下 */
  touchDown(x: number, y: number): Promise<void>;

  /** 触摸抬起 */
  touchUp(x: number, y: number): Promise<void>;

  /** 触摸移动 */
  touchMove(x: number, y: number): Promise<void>;

  /** 获取屏幕尺寸 */
  getScreenSize(): Promise<{ width: number; height: number }>;

  /** 获取 UI 布局 */
  getLayout(): Promise<string>;
}

/**
 * Scrcpy 视频流接口
 */
export interface IScrcpyStream {
  /** 启动视频流 */
  start(opts: {
    onData: (data: Buffer) => void;
    onReady: () => void;
    onError: (err: Error) => void;
  }): Promise<void>;

  /** 请求 IDR 帧 */
  requestIdrFrame(): Promise<void>;

  /** 停止视频流 */
  stop(): Promise<void>;
}

/**
 * 设备上下文类型（用于工厂返回类型）
 */
export interface IDeviceContext {
  manager: IDeviceManager;
  uitest: IUitestServer;
  addClient(clientId: string): void;
  removeClient(clientId: string): void;
  getClientCount(): number;
  isScrcpyStarted(): boolean;
  isPersistent(): boolean;
  startScreenCast(ws?: any, clientId?: string): Promise<void>;
  startUitestCast(ws: any): Promise<void>;
  stopCast(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * 设备工厂接口
 */
export interface IDeviceFactory {
  /** 创建 HDC 客户端 */
  createHdcClient(config: {
    hdcPath?: string;
    ip?: string;
    sn: string;
    port?: number;
  }): IHdcClient;

  /** 创建端口转发管理器 */
  createPortForwardManager(hdc: IHdcClient): IPortForwardManager;

  /** 创建设备管理器 */
  createDeviceManager(config: ScrcpyConfig): IDeviceManager;

  /** 创建 UiTest 服务 */
  createUitestServer(manager: IDeviceManager): IUitestServer;

  /** 创建 Scrcpy 视频流 */
  createScrcpyStream(manager: IDeviceManager): IScrcpyStream;

  /** 创建设备上下文（完整组装） */
  createDeviceContext(config: ScrcpyConfig & { persistent?: boolean }): IDeviceContext;
}
