import type { ScreenModel, Locator } from '../screen-model';
import type {
  PageGraph, PageNode, Edge, OpType,
  PageFingerprint, NormalizedSkeleton,
} from '../page-graph';
import type { PopupInfo } from '../page-graph';

/** 设备原语接口(依赖注入)。生产由 mcp-device 实现,测试由 Fake 实现。 */
export interface DevicePrimitives {
  screenSize: { w: number; h: number };
  /** dump 当前屏 → ScreenModel(实现须更新 MVP 代际,保证后续 tapRef 代际校验通过)。 */
  dump(): Promise<ScreenModel>;
  /** 按 ref 触摸(代际校验由实现保证,MVP actByRef)。 */
  tapRef(ref: string): Promise<void>;
  /** 坐标兜底触摸(fallbackCoord)。 */
  tapCoord(x: number, y: number): Promise<void>;
  pressBack(): Promise<void>;
  launchApp(bundle: string, ability?: string): Promise<void>;
  /** 强制停止 app(冷启动回 root,绕开 launchApp 幂等不重置状态)。 */
  forceStop(bundle: string): Promise<void>;
  shell(cmd: string, timeoutSec?: number): Promise<string>;
  /** daemon 卡死/丢失时的恢复(kill + reconnect)。 */
  recover(): Promise<void>;
}

/** 一次感知(dump + 剥离弹窗 + 指纹)。skeleton 供 PageNode.skeletonArchive。 */
export interface SenseResult {
  model: ScreenModel;
  fingerprint: PageFingerprint;
  skeleton: NormalizedSkeleton;
  popup: PopupInfo | null;
}

/** Locator 解析失败且无 fallbackCoord 时抛出。 */
export class LocatorUnresolved extends Error {
  constructor(public locator: Locator) {
    super(`Locator 未解析且无坐标兜底:${JSON.stringify(locator)}`);
    this.name = 'LocatorUnresolved';
  }
}

export interface ExplorerConfig {
  appBundle: string;
  appVersion: string;
  appAbility?: string;            // 回 root 冷启动 ability,默认 EntryAbility
  maxSteps: number;               // 总步数预算
  maxNoNewPage: number;           // 连续无新页 → 终止
  maxBacktrackFail: number;       // 回 root 重规划失败预算
  sampleLimit: number;            // 单节点 frontier 抽样上限 M(spec §4.4.1)
  toggleAnchorThreshold?: number; // toggle/navigate 锚点阈值,默认 0.6
}

export interface CoverageReport {
  visited: number;
  dangerousSkipped: number;
  sampledOut: number;
  failed: number;
  total: number;
  rate: number;                   // visited / (total - dangerous - sampled)
}

export type TerminationReason = 'no-new-page' | 'step-budget' | 'backtrack-failed' | 'manual';

export interface ExploreReport {
  graph: PageGraph;
  steps: number;
  newPages: number;
  terminated: TerminationReason;
  coverage: CoverageReport;
}

export type { PageGraph, PageNode, Edge, OpType };
