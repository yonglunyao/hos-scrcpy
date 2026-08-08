import { describe, it, expect } from 'vitest';
import { formatDiff } from '../../../src/explore/format-diff';
import type { GraphDiff, PageNode } from '../../../src/page-graph';

function node(id: string, anchors: string[] = []): PageNode {
  return { id, fingerprint: { version: 'v1', skeletonHash: id, anchors }, skeletonArchive: { nodes: [], lists: [] }, frontierExplored: [], frontierPending: [], visitedAt: 0 };
}

describe('formatDiff', () => {
  it('summary 计数 + 空报告', () => {
    const r = formatDiff({ unchanged: [], revised: [], added: [], removed: [] });
    expect(r.summary).toEqual({ unchanged: 0, revised: 0, added: 0, removed: 0 });
    expect(r.text).toContain('unchanged=0 revised=0 added=0 removed=0');
  });
  it('revised 报告含 anchors + jaccard', () => {
    const d: GraphDiff = {
      unchanged: [node('u')],
      revised: [{ oldNode: node('o', ['设置', '关于']), newNode: node('n', ['设置', '显示']), jaccard: 0.67 }],
      added: [], removed: [],
    };
    const r = formatDiff(d);
    expect(r.summary.revised).toBe(1);
    expect(r.text).toContain('改版');
    expect(r.text).toContain('设置/关于');
    expect(r.text).toContain('设置/显示');
    expect(r.text).toContain('0.67');
  });
  it('added/removed 分别成节', () => {
    const d: GraphDiff = {
      unchanged: [], revised: [],
      added: [node('a', ['新页'])], removed: [node('rm', ['旧页'])],
    };
    const r = formatDiff(d);
    expect(r.text).toContain('新增');
    expect(r.text).toContain('新页');
    expect(r.text).toContain('移除');
    expect(r.text).toContain('旧页');
  });
  it('无锚点节点显示占位', () => {
    const d: GraphDiff = { unchanged: [], revised: [], added: [node('a')], removed: [] };
    const r = formatDiff(d);
    expect(r.text).toContain('(无锚点)');
  });
});
