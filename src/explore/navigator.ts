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
  maxBadEdges: number;    // 连续不可用边阈值 M → 中止(spec §4.5)
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
 * 导航器(spec §4.5):在 PageGraph 上 BFS 规划,逐步用 ActExecutor 执行 + 落点核验。
 *
 * 落点≠预期时重验 maxReverify 次(防 dump 抖动);仍不符用 classifyInconsistency 四分类:
 * consistent(动态噪声)→ 视为到达继续;否则改版 → 标该边 verified=false 并中止交 review。
 * 遇弹窗(spec §4.6 由 DecisionEngine 关弹窗)→ MVP 记 popup 中止(关弹窗动作留后续阶段)。
 */
export class Navigator {
  constructor(private act: ActExecutor, private graph: PageGraph) {}

  async navigate(cur: SenseResult, target: NavTarget, cfg: NavConfig): Promise<NavResult> {
    const startHash = cur.fingerprint.skeletonHash;
    const path = planPath(this.graph, startHash, target.fingerprintHash, { maxSteps: cfg.maxPathSteps });
    const fail = (reason: NavReason, traversed: number, current: string, verified: boolean[]): NavResult => ({
      success: false, reason, path: path ?? [], traversed, currentHash: current, verified,
    });
    if (!path) return fail('no-path', 0, startHash, []);
    if (path.length === 1) return { success: true, reason: 'arrived', path, traversed: 0, currentHash: startHash, verified: [] };

    let current = cur;
    let badStreak = 0;
    const verified: boolean[] = [];

    for (let i = 1; i < path.length; i++) {
      const fromId = path[i - 1]!;
      const toId = path[i]!;
      const edge = this.findEdge(fromId, toId);
      if (!edge) return fail('failed', verified.filter(Boolean).length, current.fingerprint.skeletonHash, verified);

      let result;
      try {
        result = await this.act.perform(current, edge.locator, edge.fallbackCoord);
      } catch {
        badStreak++;
        verified.push(false);
        if (badStreak >= cfg.maxBadEdges) return fail('bad-edges', verified.filter(Boolean).length, current.fingerprint.skeletonHash, verified);
        continue;
      }

      // 弹窗:spec §4.6 由 DecisionEngine 关弹窗后重验;MVP 记 popup 中止
      if (result.popup) {
        verified.push(false);
        return fail('popup', verified.filter(Boolean).length, result.after.fingerprint.skeletonHash, verified);
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
        badStreak = 0;
        current = landing;
      } else {
        // 落点不符 → 四分类(spec §4.6):consistent=动态噪声视为到达;其余=改版标边中止
        const kind = classifyInconsistency(toNode.fingerprint, landing.fingerprint, null);
        if (kind === 'consistent') {
          verified.push(true);
          badStreak = 0;
          current = landing;
        } else {
          edge.verified = false;
          verified.push(false);
          return fail('revision', verified.filter(Boolean).length - 1, landing.fingerprint.skeletonHash, verified);
        }
      }
    }

    const reached = current.fingerprint.skeletonHash === target.fingerprintHash;
    return reached
      ? { success: true, reason: 'arrived', path, traversed: verified.filter(Boolean).length, currentHash: current.fingerprint.skeletonHash, verified }
      : fail('failed', verified.filter(Boolean).length, current.fingerprint.skeletonHash, verified);
  }

  private findEdge(fromId: string, toId: string): Edge | undefined {
    return this.graph.edges.find((e) => e.from === fromId && e.to === toId && (e.verified || e.opType === 'navigate'));
  }
}
