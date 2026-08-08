import type { ScreenModel } from '../screen-model';
import type { DevicePrimitives } from './types';

export interface WatchdogOptions {
  actTimeoutMs?: number;   // 操作超时,默认 12000(spec §4.7:正常<1s,降到 10–15s)
}

const DEFAULT_TIMEOUT = 12000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`operation timed out after ${ms}ms`)), ms)),
  ]);
}

/** Daemon 看门狗(spec §4.7):socket 探活 + 超时恢复。装饰 DevicePrimitives。 */
export class DaemonWatchdog implements DevicePrimitives {
  constructor(private inner: DevicePrimitives, private opts: WatchdogOptions = {}) {}

  get screenSize() { return this.inner.screenSize; }
  get actTimeoutMs() { return this.opts.actTimeoutMs ?? DEFAULT_TIMEOUT; }

  /** pre-flight:daemon socket 是否存在(spec §4.7)。 */
  async preFlight(): Promise<boolean> {
    try {
      const out = await this.inner.shell('cat /proc/net/unix 2>/dev/null | grep -c uitest_socket');
      return /[1-9]/.test(out.trim());
    } catch {
      return false;
    }
  }

  private async ensureAlive(): Promise<void> {
    const out = await this.inner.shell('cat /proc/net/unix 2>/dev/null | grep -c uitest_socket');
    if (!/[1-9]/.test(out.trim())) await this.inner.recover();
  }

  /** 探活 → 操作 → 超时则 recover → 重试一次。 */
  private async guarded<T>(op: () => Promise<T>): Promise<T> {
    await this.ensureAlive();
    try {
      return await withTimeout(op(), this.actTimeoutMs);
    } catch {
      await this.inner.recover();
      return await withTimeout(op(), this.actTimeoutMs);
    }
  }

  async dump(): Promise<ScreenModel> { return this.guarded(() => this.inner.dump()); }
  async tapRef(ref: string): Promise<void> { return this.guarded(() => this.inner.tapRef(ref)); }
  async tapCoord(x: number, y: number): Promise<void> { return this.guarded(() => this.inner.tapCoord(x, y)); }
  async pressBack(): Promise<void> { return this.guarded(() => this.inner.pressBack()); }
  launchApp(bundle: string, ability?: string): Promise<void> { return this.inner.launchApp(bundle, ability); }  // aa start 走 hdc
  forceStop(bundle: string): Promise<void> { return this.inner.forceStop(bundle); }                              // aa force-stop 走 hdc
  shell(cmd: string, timeoutSec?: number): Promise<string> { return this.inner.shell(cmd, timeoutSec); }          // 不探活(避免递归)
  recover(): Promise<void> { return this.inner.recover(); }
}
