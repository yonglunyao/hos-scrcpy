import { HdcClient } from './hdc';
import { PortForwardManager } from './port-forward';
import { DeviceManager } from './application/device-manager';
import { UitestServer } from '../input/infrastructure/uitest-server';
import { DeviceContext } from './context';
import { IHdcClient, IDeviceManager, IUitestServer, IPortForwardManager, IScrcpyStream, IDeviceFactory, IDeviceContext } from './interfaces';
import type { ScrcpyConfig } from '../shared/types';
import { DEFAULT_HDC_PORT } from '../constants';

// Re-export IDeviceFactory for external use
export type { IDeviceFactory };

/**
 * 设备工厂 — 负责创建和组装设备相关组件
 *
 * 工厂模式的好处：
 * - 集中管理对象创建逻辑
 * - 便于测试（可注入 mock）
 * - 支持依赖注入
 */
export class DeviceFactory implements IDeviceFactory {
  /**
   * 创建 HDC 客户端
   *
   * @param config - HDC 配置
   * @returns HDC 客户端实例
   */
  createHdcClient(config: {
    hdcPath?: string;
    ip?: string;
    sn: string;
    port?: number;
  }): IHdcClient {
    return new HdcClient({
      hdcPath: config.hdcPath || 'hdc',
      ip: config.ip || '127.0.0.1',
      sn: config.sn,
      port: config.port || DEFAULT_HDC_PORT,
    });
  }

  /**
   * 创建端口转发管理器
   *
   * @param hdc - HDC 客户端实例
   * @returns 端口转发管理器实例
   */
  createPortForwardManager(hdc: IHdcClient): IPortForwardManager {
    const pf = new PortForwardManager(hdc as HdcClient);
    return pf as unknown as IPortForwardManager;
  }

  /**
   * 创建设备管理器
   *
   * @param config - Scrcpy 配置
   * @returns 设备管理器实例
   */
  createDeviceManager(config: ScrcpyConfig): IDeviceManager {
    const hdc = this.createHdcClient({
      hdcPath: config.hdcPath,
      ip: config.ip,
      sn: config.sn,
      port: config.hdcPort,
    });
    const portForward = this.createPortForwardManager(hdc);
    return new DeviceManager(hdc, portForward as PortForwardManager, config);
  }

  /**
   * 创建 UiTest 服务
   *
   * @param manager - 设备管理器实例
   * @returns UiTest 服务实例
   */
  createUitestServer(manager: IDeviceManager): IUitestServer {
    return new UitestServer(manager);
  }

  /**
   * 创建 Scrcpy 视频流
   *
   * @param manager - 设备管理器实例
   * @returns Scrcpy 视频流实例
   */
  createScrcpyStream(manager: IDeviceManager): IScrcpyStream {
    const { DirectScrcpyStream } = require('../capture/direct-scrcpy');
    return new DirectScrcpyStream(manager);
  }

  /**
   * 创建设备上下文（完整组装）
   *
   * @param config - Scrcpy 配置
   * @returns 设备上下文实例
   */
  createDeviceContext(config: ScrcpyConfig & { persistent?: boolean }): IDeviceContext {
    const manager = this.createDeviceManager(config);
    const uitest = this.createUitestServer(manager);
    return new DeviceContext(manager, uitest, config.persistent || false);
  }

  /**
   * 创建设备上下文（使用已存在的组件）
   *
   * @param manager - 设备管理器实例
   * @param uitest - UiTest 服务实例
   * @param persistent - 是否持久化投屏
   * @returns 设备上下文实例
   */
  createDeviceContextFromComponents(
    manager: IDeviceManager,
    uitest: IUitestServer,
    persistent: boolean = false,
  ): DeviceContext {
    return new DeviceContext(manager, uitest, persistent);
  }
}
