import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MapStore, diffGraphs } from '../../../src/page-graph/store';
import type { PageGraph, PageNode } from '../../../src/page-graph/types';

function emptyGraph(appBundle: string, appVersion: string): PageGraph {
  return { appBundle, appVersion, fingerprintVersion: 'v1', nodes: new Map(), edges: [], entryPoints: [] };
}
function node(id: string): PageNode {
  return { id, fingerprint: { version: 'v1', skeletonHash: id, anchors: [] }, skeletonArchive: { nodes: [], lists: [] }, frontierExplored: [], frontierPending: [], visitedAt: 0 };
}

describe('MapStore', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pg-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('序列化/反序列化往返一致(含 Map)', () => {
    const store = new MapStore(dir);
    const g = emptyGraph('com.test', '1.0');
    g.nodes.set('h1', node('h1'));
    store.save(g);
    const loaded = store.load('com.test', '1.0');
    expect(loaded?.nodes.get('h1')).toBeDefined();
    expect(loaded?.nodes.size).toBe(1);
  });

  it('增量 appendNode:新节点追加', () => {
    const store = new MapStore(dir);
    const g = emptyGraph('com.test', '1.0');
    store.save(g);
    g.nodes.set('h2', node('h2'));
    store.appendNode(g, g.nodes.get('h2')!);
    const loaded = store.load('com.test', '1.0');
    expect(loaded?.nodes.size).toBe(1);
    expect(loaded?.nodes.get('h2')).toBeDefined();
  });

  it('原子写:产出合法 JSON(write-to-temp + rename)', () => {
    const store = new MapStore(dir);
    store.save(emptyGraph('com.test', '1.0'));
    const file = join(dir, 'com.test-1.0.json');
    expect(existsSync(file)).toBe(true);
    expect(() => JSON.parse(readFileSync(file, 'utf-8'))).not.toThrow();
  });

  it('fingerprintVersion 不匹配 → 拒绝加载', () => {
    const store = new MapStore(dir);
    const g = emptyGraph('com.test', '1.0');
    g.fingerprintVersion = 'v0';   // 旧版本
    store.save(g);
    expect(() => store.load('com.test', '1.0')).toThrow(/fingerprintVersion/);
  });

  it('list():列出已存档的 app', () => {
    const store = new MapStore(dir);
    store.save(emptyGraph('com.test', '1.0'));
    store.save(emptyGraph('com.other', '2.0'));
    const names = store.list();
    expect(names.some((n) => n.includes('com.test'))).toBe(true);
    expect(names.some((n) => n.includes('com.other'))).toBe(true);
  });
});

// --- diffGraphs: skeletonHash 精确 + anchors 二次匹配 ---
function graphWith(appBundle: string, ...nodes: PageNode[]): PageGraph {
  const g: PageGraph = { appBundle, appVersion: '1.0', fingerprintVersion: 'v1', nodes: new Map(), edges: [], entryPoints: [] };
  for (const n of nodes) g.nodes.set(n.id, n);
  return g;
}
function fpNode(id: string, skeletonHash: string, anchors: string[]): PageNode {
  return { id, fingerprint: { version: 'v1', skeletonHash, anchors }, skeletonArchive: { nodes: [], lists: [] }, frontierExplored: [], frontierPending: [], visitedAt: 0 };
}

describe('diffGraphs', () => {
  it('精确 skeletonHash 匹配 → unchanged', () => {
    const a = graphWith('app', fpNode('h1', 'hash1', ['设置']));
    const b = graphWith('app', fpNode('h1', 'hash1', ['设置']));
    const d = diffGraphs(a, b);
    expect(d.unchanged.map((n) => n.id)).toContain('h1');
    expect(d.added.length + d.removed.length + d.revised.length).toBe(0);
  });

  it('hash 变但 anchors 同 → revised(非 removed+added)', () => {
    const a = graphWith('app', fpNode('old', 'hashOld', ['设置', '关于']));
    const b = graphWith('app', fpNode('new', 'hashNew', ['设置', '关于']));
    const d = diffGraphs(a, b, { anchorThreshold: 0.8 });
    expect(d.revised.length).toBe(1);
    expect(d.revised[0].jaccard).toBeGreaterThan(0.8);
    expect(d.added.length + d.removed.length).toBe(0);
  });

  it('hash 变 + anchors 也不同 → added + removed', () => {
    const a = graphWith('app', fpNode('o', 'hO', ['AAA']));
    const b = graphWith('app', fpNode('n', 'hN', ['BBB']));
    const d = diffGraphs(a, b, { anchorThreshold: 0.8 });
    expect(d.removed.map((n) => n.id)).toContain('o');
    expect(d.added.map((n) => n.id)).toContain('n');
  });
});
