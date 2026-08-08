import { writeFileSync, readFileSync, existsSync, renameSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import type { PageGraph, PageNode } from './types';
import { FINGERPRINT_VERSION } from './types';

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

// Map 序列化支持(JSON 不原生支持 Map)
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return { __map: [...value.entries()] };
  return value;
}
function reviver(_key: string, value: any): any {
  if (value && typeof value === 'object' && Array.isArray(value.__map)) return new Map(value.__map);
  return value;
}
