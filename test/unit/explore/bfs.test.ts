import { describe, it, expect } from 'vitest';
import { planPath } from '../../../src/explore/bfs';
import type { PageGraph, PageNode, Edge } from '../../../src/page-graph';

function node(id: string, anchors: string[] = []): PageNode {
  return { id, fingerprint: { version: 'v2', skeletonHash: id, anchors }, skeletonArchive: { nodes: [], lists: [] }, frontierExplored: [], frontierPending: [], visitedAt: 0 };
}
function edge(from: string, to: string, opType: Edge['opType'] = 'navigate', verified = true): Edge {
  return { from, locator: { text: to }, to, opType, backNavigable: 'unknown', effectReversible: false, verified };
}
function graph(nodes: PageNode[], edges: Edge[]): PageGraph {
  return { appBundle: 't', appVersion: '1', fingerprintVersion: 'v2', nodes: new Map(nodes.map((n) => [n.id, n])), edges, entryPoints: [] };
}

describe('planPath', () => {
  it('from==target → [from]', () => {
    expect(planPath(graph([node('a')], []), 'a', 'a', { maxSteps: 5 })).toEqual(['a']);
  });
  it('直连边 a→b → [a,b]', () => {
    expect(planPath(graph([node('a'), node('b')], [edge('a', 'b')]), 'a', 'b', { maxSteps: 5 })).toEqual(['a', 'b']);
  });
  it('最短路径:直连优先 a→c over a→b→c', () => {
    const g = graph([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')]);
    expect(planPath(g, 'a', 'c', { maxSteps: 5 })).toEqual(['a', 'c']);
  });
  it('无路径 → null', () => {
    expect(planPath(graph([node('a'), node('b')], []), 'a', 'b', { maxSteps: 5 })).toBeNull();
  });
  it('目标节点不存在 → null', () => {
    expect(planPath(graph([node('a')], []), 'a', 'z', { maxSteps: 5 })).toBeNull();
  });
  it('超 maxSteps → null(a→b→c→d 需 3 步,maxSteps=2)', () => {
    const g = graph([node('a'), node('b'), node('c'), node('d')], [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')]);
    expect(planPath(g, 'a', 'd', { maxSteps: 2 })).toBeNull();
  });
  it('自环 toggle 边不扩路径', () => {
    const g = graph([node('a'), node('b')], [edge('a', 'a', 'toggle'), edge('a', 'b')]);
    expect(planPath(g, 'a', 'b', { maxSteps: 5 })).toEqual(['a', 'b']);
  });
  it('external 边不走', () => {
    expect(planPath(graph([node('a'), node('b')], [edge('a', 'b', 'external')]), 'a', 'b', { maxSteps: 5 })).toBeNull();
  });
  it('destructive 边不走', () => {
    expect(planPath(graph([node('a'), node('b')], [edge('a', 'b', 'destructive')]), 'a', 'b', { maxSteps: 5 })).toBeNull();
  });
  it('verified=false 的 toggle 边不走', () => {
    expect(planPath(graph([node('a'), node('b')], [edge('a', 'b', 'toggle', false)]), 'a', 'b', { maxSteps: 5 })).toBeNull();
  });
  it('未 verified 的 navigate 边仍可走', () => {
    expect(planPath(graph([node('a'), node('b')], [edge('a', 'b', 'navigate', false)]), 'a', 'b', { maxSteps: 5 })).toEqual(['a', 'b']);
  });
});
