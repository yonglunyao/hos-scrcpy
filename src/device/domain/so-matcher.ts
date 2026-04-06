/**
 * SO 版本匹配领域服务 — MD5 校验、SO 推送、列表选择
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { IHdcClient } from '../interfaces';

const DEVICE_EXTENSION_PATH = '/data/local/tmp/%s';

/** 普通版本 SO 列表（uitest < 6.0.2.1） */
export const SCRCPY_SO_LIST = [
  'libscrcpy_server1.z.so',
  'libscrcpy_server2.z.so',
  'libscrcpy_server3.z.so',
  'libscrcpy_server-5.8-20250925.so',
];

/** 新版 SO 列表（uitest >= 6.0.2.1） */
export const SCRCPY_SEC_SO_LIST = [
  'libscrcpy_server-6.2-20250926.so',
];

/** Reserved for future emulator support */
export const _SCRCPY_EMULATOR_SO = 'libscrcpy_server_emulator.z.so';

/** Reserved for future recorder support */
export const _RECORDER_SO_LIST = [
  'libscrcpy_server1.z.so',
  'libscrcpy_server2.z.so',
  'libscrcpy_server3.z.so',
  'libscrcpy_server-5.8-20250925.so',
];

export const _RECORDER_SEC_SO_LIST = [
  'libscrcpy_server-6.2-20250926.so',
];

/** Agent names defined in uitest.ts */
export const _AGENT_NAMES: Record<string, string> = {
  x86_64: 'uitest_agent_x86_1.1.9.so',
  old: 'uitest_agent_1.1.3.so',
  split: 'uitest_agent_1.1.5.so',
  normal: 'uitest_agent_1.1.10.so',
  sec: 'uitest_agent_1.2.2.so',
};

export class SoVersionMatcher {
  /**
   * 获取 SO 资源文件的本地路径
   */
  static getSoAssetPath(soName: string): string {
    return path.join(__dirname, '..', '..', 'assets', 'so', soName);
  }

  /**
   * 获取本地 SO 文件的 MD5
   */
  static getLocalSoMd5(soName: string): string {
    const soPath = SoVersionMatcher.getSoAssetPath(soName);
    if (!fs.existsSync(soPath)) return '';
    const content = fs.readFileSync(soPath);
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * 格式化设备上的 SO 文件路径
   */
  static formatDevicePath(soName: string): string {
    return DEVICE_EXTENSION_PATH.replace('%s', soName);
  }

  /**
   * 获取设备上 SO 文件的 MD5
   */
  static async getDeviceSoMd5(hdc: IHdcClient, soName?: string): Promise<string> {
    const name = soName || 'libscreen_casting.z.so';
    const devicePath = SoVersionMatcher.formatDevicePath(name);
    const result = await hdc.shell(`md5sum ${devicePath}`, 8);
    const match = result.match(/^([a-fA-F0-9]+)/);
    return match ? match[1]!.toLowerCase() : '';
  }

  /**
   * 在本地 SO 列表中查找匹配设备 MD5 的 SO
   */
  static findMatchingSo(deviceMd5: string, isUseSecSo: boolean): string | null {
    const soList = isUseSecSo ? SCRCPY_SEC_SO_LIST : SCRCPY_SO_LIST;
    for (const soName of soList) {
      const localMd5 = SoVersionMatcher.getLocalSoMd5(soName);
      if (localMd5 === deviceMd5) {
        return soName;
      }
    }
    return null;
  }

  /**
   * 推送 SO 文件到设备（MD5 校验 + rename 方式）
   */
  static async pushSo(hdc: IHdcClient, soName: string, devicePath?: string): Promise<boolean> {
    const srcPath = SoVersionMatcher.getSoAssetPath(soName);
    if (!fs.existsSync(srcPath)) {
      console.error(`[SoVersionMatcher] SO not found: ${srcPath}`);
      return false;
    }
    const dest = devicePath || SoVersionMatcher.formatDevicePath(soName);

    const localMd5 = SoVersionMatcher.getLocalSoMd5(soName);
    const checkResult = await hdc.shell(`file ${dest}`, 3);
    if (checkResult.includes('ELF')) {
      const md5Result = await hdc.shell(`md5sum ${dest}`, 5);
      const match = md5Result.match(/^([a-fA-F0-9]+)/);
      if (match && match[1]!.toLowerCase() === localMd5) {
        console.log(`[SoVersionMatcher] ${soName} already up-to-date on device`);
        return true;
      }
    }

    await hdc.shell(`rm -rf ${dest}`, 5);

    const tmpPath = '/data/local/tmp/_scrcpy_tmp.so';
    await hdc.pushFile(srcPath, tmpPath);
    await hdc.shell(`mv ${tmpPath} ${dest}`, 5);
    console.log(`[SoVersionMatcher] push ${soName} -> ${dest}`);
    return true;
  }
}
