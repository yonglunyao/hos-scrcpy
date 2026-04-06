/**
 * 进程生命周期领域服务 — PID 查询、进程启停
 */

import { IHdcClient } from '../interfaces';

export class ProcessLifecycle {
  /**
   * 获取 scrcpy server PIDs（只获取带 extension-name 的）
   */
  static async getScrcpyPids(
    hdc: IHdcClient,
    extensionName: string,
    port: number,
  ): Promise<string[]> {
    const result = await hdc.shell('"ps -ef | grep singleness"', 8);
    const pids: string[] = [];

    for (const line of result.split(/\r?\n/)) {
      if (
        line.includes('singleness') &&
        (line.includes(extensionName) || line.includes('-p ' + port)) &&
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
  static async getRecorderPids(hdc: IHdcClient): Promise<string[]> {
    const result = await hdc.shell('ps -ef | grep singleness', 8);
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
  static async killScrcpy(
    hdc: IHdcClient,
    extensionName: string,
    port: number,
  ): Promise<void> {
    const pids = await ProcessLifecycle.getScrcpyPids(hdc, extensionName, port);
    for (const pid of pids) {
      await hdc.shell(`kill -9 ${pid}`, 5);
    }
  }

  /**
   * 杀死 recorder 进程
   */
  static async killRecorder(hdc: IHdcClient): Promise<void> {
    const pids = await ProcessLifecycle.getRecorderPids(hdc);
    for (const pid of pids) {
      await hdc.shell(`kill -9 ${pid}`, 5);
    }
  }

  /**
   * 确保基础 uitest daemon 在运行（extension 需要基础 daemon）
   */
  static async ensureBasicUitest(hdc: IHdcClient): Promise<void> {
    const result = await hdc.shell('ps -ef | grep uitest', 5);
    const hasBasic = result.split(/\r?\n/).some(
      line => line.includes('uitest') && line.includes('singleness') && !line.includes('extension-name') && !line.includes('grep'),
    );
    if (hasBasic) {
      console.log('[ProcessLifecycle] basic uitest already running');
      return;
    }
    console.log('[ProcessLifecycle] starting basic uitest...');
    await hdc.shell('nohup /system/bin/uitest start-daemon singleness > /dev/null 2>&1 &', 5);
    await new Promise(r => setTimeout(r, 2000));
  }
}
