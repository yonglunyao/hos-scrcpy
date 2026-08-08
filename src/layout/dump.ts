import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IDeviceManager } from '../device/interfaces';

const LAYOUT_REMOTE = '/data/local/tmp/mcp_layout.json';
const TIMEOUT_SEC = 5;

/** 通过命令行 uitest dumpLayout 获取布局 JSON。DI 签名(传入 device)避免循环 import;读后清理临时文件。 */
export async function dumpLayoutRaw(device: IDeviceManager): Promise<string> {
  await device.shell(`uitest dumpLayout -p ${LAYOUT_REMOTE}`, TIMEOUT_SEC);
  const local = path.join(os.tmpdir(), `hos-scrcpy-layout-${Date.now()}.json`);
  try {
    await device.getHdc().pullFile(LAYOUT_REMOTE, local);
    return fs.readFileSync(local, 'utf-8');
  } finally {
    fs.promises.unlink(local).catch(() => undefined);
  }
}
