import type { PageGraph, Edge } from '../page-graph';
import { classifyInconsistency } from '../page-graph';
import { ActExecutor } from './act-executor';
import { planPath } from './bfs';
import type { SenseResult } from './types';

export interface NavTarget {
  fingerprintHash: string;   // 目标节点 skeletonHash
}

export interface NavConfig {
  maxPathSteps: number;   // BFS 路径上限 K(spec §4.5)
  maxReverify: number;    // 落点不符重验次数(防 dump 抖动)
  maxBadEdges: number;    // 连续不可用边阈值 M(spec §4.5;MVP 无重规划,首次不可用即中止,留作重规划阶段启用)
}

export type NavReason = 'arrived' | 'no-path' | 'bad-edges' | 'revision' | 'popup' | 'failed';

export interface NavResult {
  success: boolean;
  reason: NavReason;
  path: string[];         // 规划路径(节点 id)
  traversed: number;      // 成功走过的边数
  currentHash: string;    // 终止时落点 skeletonHash
  verified: boolean[];    // 每条规划边核验结果
}

/**
 * 导航器(spec §4.5):PageGraph 上 BFS 规划,逐步 ActExecutor 执行 + 落点核验。
 *
 * 落点≠预期重验 maxReverify 次(防 dump 抖动);仍不符用 classifyInconsistency 四分类:
 * consistent(动态噪声)→ 视为到达继续;否则改版 → 标该边 verified=false 并中止交 review。
 * 边不可用(perform 抛出 / locator 无兜底)→ 中止 failed。
 * 遇弹窗(spec §4.6 由 DecisionEngine 关弹窗)→ MVP 记 popup 中止(关弹窗动作留后续阶段)。
 *
 * MVP 不做回退重规划(spec §4.5 "回退上一正确节点重新规划"),首次不可用即中止;
 * maxBadEdges 配置预留给重规划阶段启用。
 */
export class Navigator {
  constructor(private act: ActExecutor, private graph: PageGraph) {}

  async navigate(cur: SenseResult, target: NavTarget, cfg: NavConfig): Promise<NavResult> {
    const startHash = cur.fingerprint.skeletonHash;
    const path = planPath(this.graph, startHash, target.fingerprintHash, { maxSteps: cfg.maxPathSteps });
    if (!path) return { success: false, reason: 'no-path', path: [], traversed: 0, currentHash: startHash, verified: [] };
    if (path.length === 1) return { success: true, reason: 'arrived', path, traversed: 0, currentHash: startHash, verified: [] };

    let current = cur;
    let traversed = 0;
    const verified: boolean[] = [];

    for (let i = 1; i < path.length; i++) {
      const fromId = path[i - 1]!;
      const toId = path[i]!;
      const edge = this.findEdge(fromId, toId);
      if (!edge) {
        return { success: false, reason: 'failed', path, traversed, currentHash: current.fingerprint.skeletonHash, verified };
      }

      // 执行该边;perform 抛出(locator 无兜底等)→ 该路径不可继续,MVP 中止
      let result;
      try {
        result = await this.act.perform(current, edge.locator, edge.fallbackCoord);
      } catch {
        verified.push(false);
        return { success: false, reason: 'failed', path, traversed, currentHash: current.fingerprint.skeletonHash, verified };
      }

      // 弹窗:spec §4.6 由 DecisionEngine 关弹窗后重验;MVP 记 popup 中止
      if (result.popup) {
        verified.push(false);
        return { success: false, reason: 'popup', path, traversed, currentHash: result.after.fingerprint.skeletonHash, verified };
      }

      const toNode = this.graph.nodes.get(toId)!;
      let landing = result.after;
      let ok = landing.fingerprint.skeletonHash === toNode.fingerprint.skeletonHash;
      // 落点核验:精确 hash;不符重验 maxReverify 次(防 dump 抖动)
      for (let r = 0; r < cfg.maxReverify && !ok; r++) {
        landing = await this.act.senseStable();
        ok = landing.fingerprint.skeletonHash === toNode.fingerprint.skeletonHash;
      }

      if (ok) {
        verified.push(true);
        traversed++;
        current = landing;
      } else {
        // 落点不符 → 四分类(spec §4.6):consistent=动态噪声视为到达;其余=改版标边中止
        const kind = classifyInconsistency(toNode.fingerprint, landing.fingerprint, null);
        if (kind === 'consistent') {
          verified.push(true);
          traversed++;
          current = landing;
        } else {
          edge.verified = false;
          verified.push(false);
          return { success: false, reason: 'revision', path, traversed, currentHash: landing.fingerprint.skeletonHash, verified };
        }
      }
    }

    // 走完路径后仍需确认真正到达(防止中间边静默失败)
    const reached = current.fingerprint.skeletonHash === target.fingerprintHash;
    return reached
      ? { success: true, reason: 'arrived', path, traversed, currentHash: current.fingerprint.skeletonHash, verified }
      : { success: false, reason: 'failed', path, traversed, currentHash: current.fingerprint.skeletonHash, verified };
  }

  private findEdge(fromId: string, toId: string): Edge | undefined {
    return this.graph.edges.find((e) => e.from === fromId && e.to === toId && (e.verified || e.opType === 'navigate'));
  }
}
