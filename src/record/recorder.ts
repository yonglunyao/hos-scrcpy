/**
 * 脚本录制 / 回放 —— 复用 HarmonyOS 系统能力(uitest uiRecord + uiInput)。
 *
 * 被 MCP(server)与 Web 投屏(DeviceContext)共用,单一实现。
 * 支持:录制、同步回放、可控回放(启动/停止)、脚本导入导出。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ChildProcess } from 'child_process';
import type { IDeviceManager } from '../device/interfaces';

const RECORD_REMOTE = '/data/local/tmp/record.csv';
const RECORD_OP_TIMEOUT_SEC = 5;
const REPLAY_STEP_MS = 300; // 可控回放步间间隔,便于中途停止

export interface RecordedAction {
  op: string; // click | doubleClick | longClick | fling | drag
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  velocity?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function toInt(value: unknown): number {
  const n = parseInt(String(value ?? '0'), 10);
  return Number.isFinite(n) ? n : 0;
}

function toUiInputCmd(a: RecordedAction): string {
  switch (a.op) {
    case 'doubleClick':
      return `uitest uiInput doubleClick ${a.x} ${a.y}`;
    case 'longClick':
      return `uitest uiInput longClick ${a.x} ${a.y}`;
    case 'fling':
      return `uitest uiInput fling ${a.x} ${a.y} ${a.x2 ?? a.x} ${a.y2 ?? a.y} ${a.velocity ?? 600}`;
    case 'drag':
      return `uitest uiInput drag ${a.x} ${a.y} ${a.x2 ?? a.x} ${a.y2 ?? a.y}`;
    case 'click':
    default:
      return `uitest uiInput click ${a.x} ${a.y}`;
  }
}

/** 解析系统 record.csv(JSON Lines)为简化操作列表。 */
export function parseRecordCsv(csv: string): RecordedAction[] {
  const actions: RecordedAction[] = [];
  for (const line of csv.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const finger = Array.isArray(obj.fingerList) ? (obj.fingerList[0] as Record<string, unknown>) : {};
      const action: RecordedAction = {
        op: String(obj.OP_TYPE ?? 'click'),
        x: toInt(finger.X_POSI),
        y: toInt(finger.Y_POSI),
      };
      if (finger.X2_POSI !== undefined) action.x2 = toInt(finger.X2_POSI);
      if (finger.Y2_POSI !== undefined) action.y2 = toInt(finger.Y2_POSI);
      const velo = toInt(obj.VELO);
      if (velo > 0) action.velocity = velo;
      actions.push(action);
    } catch {
      // skip unparseable line
    }
  }
  return actions;
}

/** 导出操作列表到本地 JSON 文件(简化格式,可手写编辑、版本管理)。 */
export function exportScript(actions: RecordedAction[], localPath: string): void {
  fs.writeFileSync(localPath, JSON.stringify(actions, null, 2));
}

/** 从本地文件导入操作列表,支持简化 JSON 数组或系统 csv(JSON Lines)。 */
export function importScript(localPath: string): RecordedAction[] {
  const content = fs.readFileSync(localPath, 'utf-8').trim();
  if (content.startsWith('[')) {
    return JSON.parse(content) as RecordedAction[];
  }
  return parseRecordCsv(content);
}

/**
 * 录制器:封装系统 uiRecord 的启停、回放(同步/可控)、导入导出。
 * 每个设备/会话一个实例(MCP session、DeviceContext 各持一份)。
 */
export class Recorder {
  private recordProc: ChildProcess | null = null;
  private replayAbort = false;
  private replayTask: Promise<void> | null = null;

  constructor(private device: IDeviceManager) {}

  isRecording(): boolean {
    return this.recordProc !== null;
  }

  isReplaying(): boolean {
    return this.replayTask !== null;
  }

  /** 启动系统录制(后台 uitest uiRecord record,写 record.csv)。 */
  async start(): Promise<void> {
    if (this.recordProc) {
      throw new Error('Recording already in progress. Stop it first.');
    }
    // 清残留 record(否则 AAMS 单连接冲突)+ 清旧 csv
    await this.device.shell('pkill -9 -f uiRecord', RECORD_OP_TIMEOUT_SEC).catch(() => undefined);
    await this.device.shell(`rm -f ${RECORD_REMOTE}`, RECORD_OP_TIMEOUT_SEC).catch(() => undefined);
    await sleep(500);
    this.recordProc = this.device.getHdc().spawnShell('uitest uiRecord record');
    await sleep(2500); // 等待 "Started Recording"
  }

  /** 停止录制,解析 record.csv 返回操作列表。 */
  async stop(): Promise<RecordedAction[]> {
    if (!this.recordProc) {
      throw new Error('No active recording. Call start first.');
    }
    // 等 record 把最后的事件(尤其 fling 等计算型事件)写入 csv
    await sleep(1500);
    await this.device.shell('pkill -9 -f uiRecord', RECORD_OP_TIMEOUT_SEC).catch(() => undefined);
    try {
      this.recordProc.kill();
    } catch {
      // ignore
    }
    this.recordProc = null;
    await sleep(1000);

    const local = path.join(os.tmpdir(), `hos-scrcpy-record-${Date.now()}.csv`);
    await this.device.getHdc().pullFile(RECORD_REMOTE, local);
    return parseRecordCsv(fs.readFileSync(local, 'utf-8'));
  }

  /** 同步回放(执行完所有步,返回每步命令)。 */
  async replay(actions: RecordedAction[]): Promise<string[]> {
    const cmds: string[] = [];
    for (const action of actions) {
      const cmd = toUiInputCmd(action);
      await this.device.shell(cmd, 8);
      cmds.push(cmd);
    }
    return cmds;
  }

  /** 启动可控回放(后台异步,可被 stopReplay 中断)。同一时刻仅一个回放。 */
  startReplay(actions: RecordedAction[]): void {
    if (this.replayTask) {
      throw new Error('Replay already in progress. Call stop_replay first.');
    }
    if (actions.length === 0) {
      throw new Error('No actions to replay.');
    }
    this.replayAbort = false;
    this.replayTask = (async () => {
      try {
        for (const action of actions) {
          if (this.replayAbort) break;
          await this.device.shell(toUiInputCmd(action), 8);
          await sleep(REPLAY_STEP_MS);
        }
      } finally {
        this.replayTask = null;
      }
    })();
  }

  /** 停止可控回放。 */
  async stopReplay(): Promise<void> {
    this.replayAbort = true;
    if (this.replayTask) {
      await this.replayTask.catch(() => undefined);
    }
  }

  /** 清理:停止录制与回放。 */
  async dispose(): Promise<void> {
    await this.stopReplay().catch(() => undefined);
    if (!this.recordProc) return;
    await this.device.shell('pkill -9 -f uiRecord', RECORD_OP_TIMEOUT_SEC).catch(() => undefined);
    try {
      this.recordProc.kill();
    } catch {
      // ignore
    }
    this.recordProc = null;
  }
}
