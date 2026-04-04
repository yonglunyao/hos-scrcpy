import { execSync } from 'child_process';

/**
 * 检测是否有 HarmonyOS 设备连接，返回设备 SN 或 null
 */
export function getDeviceSn(): string | null {
  try {
    const result = execSync('hdc list targets', { timeout: 5000, encoding: 'utf-8' });
    const devices = result.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('['));
    return devices.length > 0 ? devices[0]! : null;
  } catch {
    return null;
  }
}
