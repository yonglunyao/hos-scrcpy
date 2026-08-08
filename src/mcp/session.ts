/**
 * MCP 会话状态与共享辅助。
 *
 * 单活动设备模型:connect_session 建立 DeviceManager + UitestServer(确保 uitest daemon 运行),
 * 其余工具通过 require_session 取用。全程设备坐标系(不碰视频流 scale)。
 *
 * 通道分工(与 Web 投屏路径同源,不另起炉灶):
 *  - 输入/按键:复用 UitestServer socket(touchDown/Move/Up/pressKey/inputText),低延迟。
 *  - 截图/布局:走 `uitest` 命令行(screenCap/dumpLayout)——规避 socket 连续调用的响应分包
 *    残留 bug,以及 getLayout 在部分 agent 版本(6.0.2.x)无响应的问题。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DeviceManager } from '../device/application/device-manager';
import { Recorder } from '../record/recorder';
import type { RecordedAction } from '../record/recorder';
import { HdcClient } from '../device/hdc';
import { UitestServer } from '../input/infrastructure/uitest-server';
import { SCREENSHOT_TIMEOUT_SEC } from '../constants';

export interface McpSession {
  device: DeviceManager;
  uitest: UitestServer;
  sn: string;
}

let hdcPath = process.env.HDC_PATH || 'hdc';
let session: McpSession | null = null;

export function getHdcPath(): string {
  return hdcPath;
}

export function setHdcPath(value: string): void {
  hdcPath = value;
}

export function getSession(): McpSession | null {
  return session;
}

export function requireSession(): McpSession {
  if (!session) {
    throw new Error('No active device. Call the connect_device tool first with a device serial number (sn).');
  }
  return session;
}

/** 列出已连接设备序列号(hdc list targets) */
export async function listDevices(): Promise<string[]> {
  const hdc = new HdcClient({ hdcPath, sn: '' });
  return hdc.listTargets();
}

/** 连接设备:确保 uitest daemon 运行 + 建立控制会话 */
export async function connectSession(sn: string): Promise<McpSession> {
  if (session) {
    await disconnectSession();
  }

  const device = DeviceManager.fromConfig({ sn, hdcPath });
  if (!(await device.isOnline())) {
    throw new Error(`Device ${sn} is not online. Use list_devices to see connected devices.`);
  }
  await device.ensureBasicUitest();

  const uitest = new UitestServer(device);
  await uitest.start();

  session = { device, uitest, sn };
  return session;
}

/** 断开当前设备,释放 uitest/端口转发。清理在 hdc 通信上可能阻塞,限时返回避免挂死。 */
export async function disconnectSession(): Promise<void> {
  if (!session) return;
  const prev = session;
  session = null;
  if (recorder) {
    await recorder.dispose().catch(() => undefined);
    recorder = null;
  }
  await Promise.race([
    (async () => {
      try {
        await prev.uitest.stop();
      } catch {
        // ignore cleanup errors
      }
      try {
        await prev.device.stopScrcpy();
      } catch {
        // ignore cleanup errors
      }
    })(),
    sleep(15000),
  ]);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 截图 ──

export interface ScreenshotResult {
  localPath: string;
  base64: string;
  mimeType: string;
}

const SHOT_REMOTE_PNG = '/data/local/tmp/mcp_screenshot.png';
const SHOT_REMOTE_JPG = '/data/local/tmp/mcp_screenshot.jpeg';

/**
 * 截取当前屏幕。走命令行 uitest screenCap(PNG),失败回退 snapshot_display(JPEG)。
 * 不用 socket captureScreen —— socket 在连续调用时存在响应分包残留问题,
 * 会让后续输入请求挂起;截图走命令行可让 socket 专用于输入(稳定)。
 */
export async function captureScreenshot(): Promise<ScreenshotResult> {
  const { device } = requireSession();

  try {
    await device.shell(`uitest screenCap -p ${SHOT_REMOTE_PNG}`, SCREENSHOT_TIMEOUT_SEC);
    const local = await pullToTemp(device, SHOT_REMOTE_PNG, '.png');
    return { localPath: local, base64: readBase64(local), mimeType: 'image/png' };
  } catch {
    await device.shell(`snapshot_display -f ${SHOT_REMOTE_JPG}`, SCREENSHOT_TIMEOUT_SEC);
    const local = await pullToTemp(device, SHOT_REMOTE_JPG, '.jpeg');
    return { localPath: local, base64: readBase64(local), mimeType: 'image/jpeg' };
  }
}

async function pullToTemp(device: DeviceManager, remote: string, ext: string): Promise<string> {
  const local = path.join(os.tmpdir(), `hos-scrcpy-mcp-${Date.now()}${ext}`);
  await device.getHdc().pullFile(remote, local);
  return local;
}

function readBase64(filePath: string): string {
  return fs.readFileSync(filePath).toString('base64');
}

// ── UI 布局(实现下沉 src/layout/,这里重导出保持向后兼容) ──

export { flattenLayout, dumpLayoutRaw } from '../layout';
export type { UiElement } from '../layout';

// ── 脚本录制 / 回放(薄封装共享 Recorder,MCP 与 Web 复用同一实现) ──

let recorder: Recorder | null = null;

export async function startRecord(): Promise<void> {
  if (!recorder) recorder = new Recorder(requireSession().device);
  await recorder.start();
}

export async function stopRecord(): Promise<RecordedAction[]> {
  if (!recorder) throw new Error('No active recording. Call start_record first.');
  return recorder.stop();
}

export async function replayActions(actions: RecordedAction[]): Promise<string[]> {
  if (!recorder) recorder = new Recorder(requireSession().device);
  return recorder.replay(actions);
}

/** 启动可控回放(后台异步,可被 stopReplay 中断)。 */
export function startReplayActions(actions: RecordedAction[]): void {
  if (!recorder) recorder = new Recorder(requireSession().device);
  recorder.startReplay(actions);
}

/** 停止可控回放。 */
export async function stopReplayActions(): Promise<void> {
  if (recorder) await recorder.stopReplay();
}

export { exportScript, importScript, parseRecordCsv } from '../record/recorder';
export type { RecordedAction } from '../record/recorder';
