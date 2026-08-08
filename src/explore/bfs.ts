import type { PageGraph, Edge } from '../page-graph';

export interface PlanPathOptions {
  maxSteps: number;   // 路径上限 K(spec §4.5)
}

/**
 * BFS 最短路径规划(spec §4.5):边权=1,visited set(同节点不二次入队),路径上限 maxSteps。
 *
 * 只走可步行边(navigate 或 verified,排除 external/destructive 与自环)。
 * 返回节点 id 路径(含两端 from..target),null=无路径/超限/节点不存在。
 */
export function planPath(
  graph: PageGraph,
  fromHash: string,
  targetHash: string,
  opts: PlanPathOptions,
): string[] | null {
  if (fromHash === targetHash) return [fromHash];
  if (!graph.nodes.has(fromHash) || !graph.nodes.has(targetHash)) return null;

  const adj = buildAdjacency(graph);
  const visited = new Set<string>([fromHash]);
  const queue: { id: string; path: string[] }[] = [{ id: fromHash, path: [fromHash] }];

  while (queue.length > 0) {
    const { id, path } = queue.shift()!;
    if (path.length - 1 >= opts.maxSteps) continue;     // 已达步数上限,不再扩展
    for (const next of adj.get(id) ?? []) {
      if (visited.has(next)) continue;
      const newPath = [...path, next];
      if (next === targetHash) return newPath;
      visited.add(next);
      queue.push({ id: next, path: newPath });
    }
  }
  return null;
}

/** 邻接表:from → [to](去重,仅可步行边)。 */
function buildAdjacency(graph: PageGraph): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!isWalkable(e)) continue;
    const list = adj.get(e.from) ?? [];
    if (!list.includes(e.to)) list.push(e.to);
    adj.set(e.from, list);
  }
  return adj;
}

function isWalkable(e: Edge): boolean {
  if (e.from === e.to) return false;                                    // 自环(toggle/noop)不扩路径
  if (e.opType === 'external' || e.opType === 'destructive') return false;
  if (e.verified) return true;                                          // 落点核验过的边优先可走
  return e.opType === 'navigate';                                       // 未核验的 navigate 边也可走(探索产物)
}
