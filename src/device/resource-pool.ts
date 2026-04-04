/**
 * 设备资源池 — 管理单个设备的共享资源
 *
 * 支持多客户端并发访问：
 * - scrcpy extension: 单例，共享
 * - uitest agent: 单例，共享
 * - 端口转发: 单例，共享
 * - 视频流: 多路复用
 */

import { EventEmitter } from 'events';

export interface DeviceResource {
  scrcpyPid: string | null;
  scrcpyForwardPort: number;
  uitestPid: string | null;
  uitestForwardPort: number;
  clients: Set<string>;  // clientId set
  videoSubscribers: Set<(data: Buffer) => void>;
}

export class DeviceResourcePool {
  private resources = new Map<string, DeviceResource>();

  /**
   * 获取或创建设备资源
   */
  acquire(deviceId: string, clientId: string): DeviceResource {
    let resource = this.resources.get(deviceId);

    if (!resource) {
      resource = {
        scrcpyPid: null,
        scrcpyForwardPort: 0,
        uitestPid: null,
        uitestForwardPort: 0,
        clients: new Set(),
        videoSubscribers: new Set(),
      };
      this.resources.set(deviceId, resource);
    }

    resource.clients.add(clientId);
    return resource;
  }

  /**
   * 释放设备资源
   */
  release(deviceId: string, clientId: string): boolean {
    const resource = this.resources.get(deviceId);
    if (!resource) return false;

    resource.clients.delete(clientId);

    // 如果没有客户端了，可以清理资源
    if (resource.clients.size === 0) {
      this.resources.delete(deviceId);
      return true;  // 资源已完全释放
    }
    return false;  // 还有其他客户端在使用
  }

  /**
   * 添加视频订阅者
   */
  subscribeVideo(deviceId: string, callback: (data: Buffer) => void): () => void {
    const resource = this.resources.get(deviceId);
    if (!resource) return () => {};

    resource.videoSubscribers.add(callback);

    // 返回取消订阅函数
    return () => {
      resource.videoSubscribers.delete(callback);
    };
  }

  /**
   * 广播视频数据给所有订阅者
   */
  broadcastVideo(deviceId: string, data: Buffer): void {
    const resource = this.resources.get(deviceId);
    if (!resource) return;

    for (const callback of resource.videoSubscribers) {
      try {
        callback(data);
      } catch (err) {
        console.error('[ResourcePool] Video callback error:', err);
      }
    }
  }

  /**
   * 获取客户端数量
   */
  getClientCount(deviceId: string): number {
    const resource = this.resources.get(deviceId);
    return resource ? resource.clients.size : 0;
  }

  /**
   * 检查设备是否正在使用
   */
  isInUse(deviceId: string): boolean {
    const resource = this.resources.get(deviceId);
    return resource ? resource.clients.size > 0 : false;
  }

  /**
   * 获取所有设备状态
   */
  getStatus(): Record<string, { clients: number; subscribers: number }> {
    const status: Record<string, { clients: number; subscribers: number }> = {};
    for (const [id, resource] of this.resources) {
      status[id] = {
        clients: resource.clients.size,
        subscribers: resource.videoSubscribers.size,
      };
    }
    return status;
  }
}

// 全局单例
export const deviceResourcePool = new DeviceResourcePool();
