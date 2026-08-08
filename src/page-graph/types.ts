import type { Element, Locator } from '../screen-model';

/** 指纹算法版本;规范化规则变更必升版本,旧图不静默碰撞。 */
export const FINGERPRINT_VERSION = 'v1';

export type OpType =
  | 'navigate' | 'toggle' | 'noop'
  | 'destructive' | 'external' | 'modal' | 'unknown';

/** 指纹输入:Element + 补充的 checked(规则⑤用)。不改 MVP Element,模块内扩展。 */
export interface FingerprintInput {
  elements: ReadonlyArray<Element & { checked?: boolean }>;
  /** 设备分辨率,用于几何签名归一化坐标;缺省按 bounds 推导 */
  screenSize?: { w: number; h: number };
}

/** 规范化后的骨架(canonical 序列化的输入)。 */
export interface NormalizedSkeleton {
  nodes: NormalizedNode[];
  lists: ListSummary[];
  geometry?: string;
}

export interface NormalizedNode {
  text: string;
  type: string;
  depth: number;
}

export interface ListSummary {
  type: string;
  countBucket: string;      // '1' | '2-5' | '6-20' | '21-100' | '100+'
  itemSigs: string[];
}

export interface PageFingerprint {
  version: string;
  skeletonHash: string;
  anchors: string[];
}

export interface PageNode {
  id: string;
  fingerprint: PageFingerprint;
  skeletonArchive: NormalizedSkeleton;
  frontierExplored: Locator[];
  frontierPending: Locator[];
  visitedAt: number;
}

export interface Edge {
  from: string;
  locator: Locator;
  fallbackCoord?: { x: number; y: number };
  to: string;
  opType: OpType;
  backNavigable: 'confirmed' | 'heuristic' | 'unknown';
  effectReversible: boolean;
  verified: boolean;
}

export interface PageGraph {
  appBundle: string;
  appVersion: string;
  fingerprintVersion: string;
  stateLabel?: { ts?: number; network?: string; loggedIn?: boolean };
  nodes: Map<string, PageNode>;
  edges: Edge[];
  entryPoints: { id: string; label: string; origin: 'launcher' | 'deeplink' | 'notification' }[];
  rootId?: string;
}
