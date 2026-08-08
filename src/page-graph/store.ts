import { writeFileSync, readFileSync, existsSync, renameSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import type { PageGraph, PageNode } from './types';
import { FINGERPRINT_VERSION } from './types';
import { matchAnchors } from './fingerprint';

/**
 * MapStore:PageGraph 的文件持久化。
 *
 * - 序列化:JSON 不原生支持 Map,用 replacer/reviver 把 nodes: Map 转 {__map: entries }。
 * - 原子写:write-to-temp + rename,防中途 crash 损坏 JSON。
 * - 版本闸:fingerprintVersion 不匹配 → 拒绝加载(规范化规则迭代致旧图失效时不静默碰撞)。
 */
export class MapStore {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private path(appBundle: string, appVersion: string): string {
    return join(this.dir, `${appBundle}-${appVersion}.json`);
  }

  /** 全量保存(write-to-temp + rename 原子)。 */
  save(graph: PageGraph): void {
    const file = this.path(graph.appBundle, graph.appVersion);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(graph, replacer));
    renameSync(tmp, file);
  }

  /** 增量追加节点(读-改-原子写)。 */
  appendNode(graph: PageGraph, node: PageNode): void {
    graph.nodes.set(node.id, node);
    this.save(graph);
  }

  /** 加载并校验 fingerprintVersion;文件不存在返回 undefined。 */
  load(appBundle: string, appVersion: string): PageGraph | undefined {
    const file = this.path(appBundle, appVersion);
    if (!existsSync(file)) return undefined;
    const graph = JSON.parse(readFileSync(file, 'utf-8'), reviver) as PageGraph;
    // 结构校验:nodes 必须是 Map(reviver 已转),防损坏文件静默误用。
    if (!graph || !(graph.nodes instanceof Map)) {
      throw new Error('地图文件结构损坏:nodes 字段缺失或非 Map');
    }
    if (graph.fingerprintVersion !== FINGERPRINT_VERSION) {
      throw new Error(
        `fingerprintVersion 不匹配:图=${graph.fingerprintVersion} 当前=${FINGERPRINT_VERSION},拒绝加载`,
      );
    }
    return graph;
  }

  /** 列出已存档图文件名。 */
  list(): string[] {
    return existsSync(this.dir) ? readdirSync(this.dir).filter((f) => f.endsWith('.json')) : [];
  }
}

export interface GraphDiff {
  unchanged: PageNode[];
  revised: { oldNode: PageNode; newNode: PageNode; jaccard: number }[];
  added: PageNode[];
  removed: PageNode[];
}

/**
 * 三遍匹配:skeletonHash 精确→unchanged;剩余 anchors Jaccard≥threshold→revised;其余→added/removed。
 *
 * revised 标"改版"(同页内容更新),区别于 removed+added(页面消失/新增)。
 * anchorThreshold 默认 0.6(spec §4.8,待 Task 10 spike 回填)。
 */
export function diffGraphs(
  oldGraph: PageGraph,
  newGraph: PageGraph,
  opts: { anchorThreshold?: number } = {},
): GraphDiff {
  // 版本闸(spec §4.8):两侧 fingerprintVersion 不一致 → 拒绝 diff,防跨版本骨架静默假比较。
  if (oldGraph.fingerprintVersion !== newGraph.fingerprintVersion) {
    throw new Error(
      `diff 拒绝:fingerprintVersion 不一致 old=${oldGraph.fingerprintVersion} new=${newGraph.fingerprintVersion}`,
    );
  }
  const t = opts.anchorThreshold ?? 0.6;
  const oldNodes = [...oldGraph.nodes.values()];
  const newNodes = [...newGraph.nodes.values()];

  const unchanged: PageNode[] = [];
  const revised: GraphDiff['revised'] = [];
  const added: PageNode[] = [];
  const removed: PageNode[] = [...oldNodes];

  for (const n of newNodes) {
    // 第一遍:skeletonHash 精确匹配
    const exact = removed.find((o) => o.fingerprint.skeletonHash === n.fingerprint.skeletonHash);
    if (exact) {
      unchanged.push(n);
      removed.splice(removed.indexOf(exact), 1);
      continue;
    }
    // 第二遍:anchors Jaccard 二次匹配(取最高)
    let best: { o: PageNode; j: number } | null = null;
    for (const o of removed) {
      const j = matchAnchors(o.fingerprint.anchors, n.fingerprint.anchors);
      if (!best || j > best.j) best = { o, j };
    }
    // 两边 anchors 都空时 matchAnchors 返回 1.0(按设计),但无法区分纯图标页;
    // 此时即便 jaccard=1 也不判 revised,走 added/removed(防 skeletonHash 不同的纯图标页误判改版)。
    const hasAnyAnchor =
      best !== null &&
      (best.o.fingerprint.anchors.length > 0 || n.fingerprint.anchors.length > 0);
    if (best && hasAnyAnchor && best.j >= t) {
      revised.push({ oldNode: best.o, newNode: n, jaccard: best.j });
      removed.splice(removed.indexOf(best.o), 1);
    } else {
      // 第三遍:既非精确也非相似 → 新增
      added.push(n);
    }
  }
  return { unchanged, revised, added, removed };
}

// Map 序列化支持(JSON 不原生支持 Map)
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return { __map: [...value.entries()] };
  return value;
}
function reviver(_key: string, value: any): any {
  if (value && typeof value === 'object' && Array.isArray(value.__map)) return new Map(value.__map);
  return value;
}
