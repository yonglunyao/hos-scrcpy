/**
 * 版本匹配领域服务 — 纯函数 + HDC 查询
 */

import { IHdcClient } from '../interfaces';

const CMD_UITEST_VERSION = '/system/bin/uitest --version';

export class VersionMatcher {
  /**
   * 比较版本号，返回 1 (target > device), -1 (target < device), 0 (equal)
   */
  static compareVersion(targetVersion: string, deviceVersion: string): number {
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
   * 获取设备上 uitest 版本号
   */
  static async getUitestVersion(hdc: IHdcClient): Promise<string> {
    const result = await hdc.shell(CMD_UITEST_VERSION, 5);
    const lines = result.split(/\r?\n/).filter(l => l.trim());
    return lines.length > 0 ? lines[lines.length - 1]!.trim() : '';
  }

  /**
   * 判断是否使用新版 SO (uitest >= 6.0.2.1)
   */
  static async detectUseSecSo(hdc: IHdcClient): Promise<boolean> {
    const version = await VersionMatcher.getUitestVersion(hdc);
    return VersionMatcher.compareVersion('6.0.2.1', version) < 0;
  }
}
