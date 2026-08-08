import { MapStore, FINGERPRINT_VERSION } from '../page-graph';
import type { PageGraph, PageNode, Edge, OpType } from '../page-graph';
import { ActExecutor } from './act-executor';
import { classifySafety } from './safety-filter';
import { classifyOpType } from './op-type';
import { extractFrontier, locatorSignature, type FrontierCandidate } from './frontier';
import type { DevicePrimitives, ExplorerConfig, ExploreReport, CoverageReport, SenseResult } from './types';

function freshGraph(cfg: ExplorerConfig): PageGraph {
  return { appBundle: cfg.appBundle, appVersion: cfg.appVersion, fingerprintVersion: FINGERPRINT_VERSION, nodes: new Map(), edges: [], entryPoints: [] };
}

export class Explorer {
  private graph: PageGraph;
  private stack: string[] = [];
  private steps = 0;
  private newPages = 0;
  private noNewStreak = 0;
  private backFail = 0;
  private edgeSigs = new Set<string>();
  private cov: CoverageReport = { visited: 0, dangerousSkipped: 0, sampledOut: 0, failed: 0, total: 0, rate: 0 };

  constructor(
    private act: ActExecutor,
    private dev: DevicePrimitives,
    private cfg: ExplorerConfig,
    private store: MapStore,
  ) {
    this.graph = this.store.load(cfg.appBundle, cfg.appVersion) ?? freshGraph(cfg);
  }

  async explore(): Promise<ExploreReport> {
    let cur = await this.act.senseStable();          // 初始感知 = root
    const root = this.upsertNode(cur);
    this.graph.rootId = root.id;
    if (this.graph.entryPoints.length === 0) {
      this.graph.entryPoints = [{ id: root.id, label: 'root', origin: 'launcher' }];
    }
    this.stack = [root.id];
    this.store.save(this.graph);

    let term: ExploreReport['terminated'] = 'step-budget';
    while (this.steps < this.cfg.maxSteps) {
      if (this.noNewStreak >= this.cfg.maxNoNewPage) { term = 'no-new-page'; break; }
      if (this.backFail >= this.cfg.maxBacktrackFail) { term = 'backtrack-failed'; break; }

      const current = this.graph.nodes.get(this.stack[this.stack.length - 1]!)!;

      // 漂移核验:cur 与栈顶一致?
      if (cur.fingerprint.skeletonHash !== current.fingerprint.skeletonHash) {
        const relocated = this.graph.nodes.get(cur.fingerprint.skeletonHash);
        if (relocated) {
          this.stack[this.stack.length - 1] = relocated.id;
        } else {
          this.noNewStreak++;
          const next = await this.backtrackSense();
          if (!next) { term = 'backtrack-failed'; break; }
          cur = next;
          continue;
        }
      }

      const fr = extractFrontier(cur.model, {
        exploredSignatures: new Set(current.frontierExplored.map(locatorSignature)),
        safety: classifySafety,
        sampleLimit: this.cfg.sampleLimit,
      });
      this.cov.total += fr.totalCandidates + fr.dangerous;
      this.cov.dangerousSkipped += fr.dangerous;
      this.cov.sampledOut += fr.sampledOut;

      if (fr.selected.length === 0) {
        this.noNewStreak++;
        if (this.noNewStreak >= this.cfg.maxNoNewPage) { term = 'no-new-page'; break; }
        const next = await this.backtrackSense();
        if (!next) { term = 'backtrack-failed'; break; }
        cur = next;
        continue;
      }

      const cand = fr.selected[0]!;
      current.frontierExplored.push(cand.locator);
      this.cov.visited++;
      this.steps++;

      let result;
      try {
        result = await this.act.perform(cur, cand.locator, cand.fallbackCoord);
      } catch {
        this.cov.failed++;
        continue;
      }

      const opType = classifyOpType({ before: cur.fingerprint, after: result.after.fingerprint, popup: result.popup });
      if (opType === 'navigate') {
        const landing = this.upsertNode(result.after);
        this.recordEdge(current, cand, landing, opType);
        if (landing.id !== current.id) {
          this.stack.push(landing.id);
          this.newPages++;
          this.noNewStreak = 0;
          this.store.appendNode(this.graph, landing);
        } else {
          this.noNewStreak++;
        }
      } else {
        // toggle/noop/modal → 自环(to=current),不裂变节点(spec §3/§4.4)
        this.recordEdge(current, cand, current, opType);
        this.noNewStreak++;
        this.store.save(this.graph);
      }
      cur = result.after;
    }

    const denom = this.cov.total - this.cov.dangerousSkipped - this.cov.sampledOut;
    this.cov.rate = denom > 0 ? this.cov.visited / denom : 0;
    this.store.save(this.graph);
    return { graph: this.graph, steps: this.steps, newPages: this.newPages, terminated: term, coverage: this.cov };
  }

  private upsertNode(sense: SenseResult): PageNode {
    const existing = this.graph.nodes.get(sense.fingerprint.skeletonHash);
    if (existing) { existing.visitedAt = sense.model.ts; return existing; }
    const node: PageNode = {
      id: sense.fingerprint.skeletonHash,
      fingerprint: sense.fingerprint,
      skeletonArchive: sense.skeleton,
      frontierExplored: [],
      frontierPending: [],
      visitedAt: sense.model.ts,
    };
    this.graph.nodes.set(node.id, node);
    return node;
  }

  private recordEdge(from: PageNode, cand: FrontierCandidate, landing: PageNode, opType: OpType): void {
    const sig = `${from.id}|${locatorSignature(cand.locator)}`;
    if (this.edgeSigs.has(sig)) return;
    this.edgeSigs.add(sig);
    const edge: Edge = {
      from: from.id, locator: cand.locator, fallbackCoord: cand.fallbackCoord,
      to: landing.id, opType, backNavigable: 'unknown', effectReversible: false, verified: opType === 'navigate',
    };
    this.graph.edges.push(edge);
  }

  /** 回溯:BACK 核验落点==父;连续 2 次失败 → 冷启动回 root(spec §4.4.3)。返回新 cur 或 null。 */
  private async backtrackSense(): Promise<SenseResult | null> {
    if (this.stack.length <= 1) return this.restartFromRootSense();
    const parent = this.graph.nodes.get(this.stack[this.stack.length - 2]!)!;
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.dev.pressBack();
      const s = await this.act.senseStable();
      if (s.fingerprint.skeletonHash === parent.fingerprint.skeletonHash) {
        this.stack.pop();
        return s;
      }
    }
    return this.restartFromRootSense();
  }

  private async restartFromRootSense(): Promise<SenseResult | null> {
    const root = this.graph.nodes.get(this.graph.rootId!);
    if (!root) { this.backFail++; return null; }
    await this.dev.launchApp(this.cfg.appBundle, this.cfg.appAbility ?? 'EntryAbility');
    const s = await this.act.senseStable();
    if (s.fingerprint.skeletonHash === root.fingerprint.skeletonHash) {
      this.stack = [this.graph.rootId!];
      return s;
    }
    this.backFail++;
    this.store.save(this.graph);
    return null;
  }
}
