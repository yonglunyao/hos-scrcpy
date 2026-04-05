import { createServer } from 'net';
import { HdcClient } from './hdc';
import { IPortForwardManager, ForwardedPort } from './interfaces';

// Port range constants reserved for future use
const _RANDOM_PORT_MIN = 36000;
const _RANDOM_PORT_RANGE = 1000;

function getRandomPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address() as { port: number };
      server.close(() => resolve(port.port));
    });
    server.on('error', reject);
  });
}

/**
 * Re-export ForwardedPort from interfaces for backward compatibility
 * @deprecated Use ForwardedPort from './interfaces' instead
 */
export type { ForwardedPort };

/**
 * 端口转发管理 — 管理 hdc fport 的创建和清理
 */
export class PortForwardManager implements IPortForwardManager {
  private hdc: HdcClient;
  private forwards: ForwardedPort[] = [];
  private lock: Promise<void> = Promise.resolve();

  constructor(hdc: HdcClient) {
    this.hdc = hdc;
  }

  /**
   * 创建 TCP 端口转发
   */
  async createTcpForward(remotePort: number): Promise<ForwardedPort> {
    return this.withLock(async () => {
      const localPort = await getRandomPort();
      await this.hdc.createForward(localPort, remotePort);
      const fwd: ForwardedPort = {
        localPort,
        release: async () => {
          await this.hdc.removeForward(localPort, remotePort);
          this.forwards = this.forwards.filter(f => f !== fwd);
        },
      };
      this.forwards.push(fwd);
      return fwd;
    });
  }

  /**
   * 创建 abstract socket 端口转发（新版 uitest/scrcpy 使用）
   */
  async createAbstractForward(abstractSocket: string): Promise<ForwardedPort> {
    return this.withLock(async () => {
      const localPort = await getRandomPort();
      await this.hdc.createAbstractForward(localPort, abstractSocket);
      const fwd: ForwardedPort = {
        localPort,
        release: async () => {
          await this.hdc.removeAbstractForward(localPort, abstractSocket);
          this.forwards = this.forwards.filter(f => f !== fwd);
        },
      };
      this.forwards.push(fwd);
      return fwd;
    });
  }

  /** 释放所有端口转发 */
  async releaseAll(): Promise<void> {
    const releases = this.forwards.map(f => f.release());
    await Promise.allSettled(releases);
    this.forwards = [];
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    let resolveLock!: () => void;
    const prev = this.lock;
    this.lock = new Promise<void>(r => { resolveLock = r; });
    await prev;
    try {
      return await fn();
    } finally {
      resolveLock();
    }
  }
}
