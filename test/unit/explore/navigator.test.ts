import { describe, it, expect } from 'vitest';
import { Navigator, type NavConfig } from '../../../src/explore/navigator';
import { ActExecutor } from '../../../src/explore/act-executor';
import { FakeDevice, model, el } from './fakes';
import { computeFingerprint, normalizeSkeleton } from '../../../src/page-graph';
import type { PageGraph, PageNode, Edge, NormalizedSkeleton, PageFingerprint } from '../../../src/page-graph';
import type { ScreenModel } from '../../../src/screen-model';
import type { SenseResult } from '../../../src/explore/types';

const SIZE = { w: 1080, h: 2340 };
function fpOf(m: ScreenModel): PageFingerprint {
  return computeFingerprint({ elements: m.elements, screenSize: SIZE });
}
function skOf(m: ScreenModel): NormalizedSkeleton {
  return normalizeSkeleton({ elements: m.elements, screenSize: SIZE });
}
function senseFor(m: ScreenModel): SenseResult {
  return { model: m, fingerprint: fpOf(m), skeleton: skOf(m), popup: null };
}
function nodeFor(m: ScreenModel): PageNode {
  const fingerprint = fpOf(m);
  return { id: fingerprint.skeletonHash, fingerprint, skeletonArchive: skOf(m), frontierExplored: [], frontierPending: [], visitedAt: 0 };
}
function navEdge(from: string, to: string): Edge {
  return { from, locator: { text: 'go-' + to }, fallbackCoord: { x: 100, y: 100 }, to, opType: 'navigate', backNavigable: 'unknown', effectReversible: false, verified: true };
}
function graphOf(ms: ScreenModel[], edges: Edge[]): PageGraph {
  return { appBundle: 't', appVersion: '1', fingerprintVersion: 'v2', nodes: new Map(ms.map((m) => [fpOf(m).skeletonHash, nodeFor(m)])), edges, entryPoints: [] };
}
const cfg = (over: Partial<NavConfig> = {}): NavConfig => ({ maxPathSteps: 6, maxReverify: 1, maxBadEdges: 2, ...over });

const A = model([el('页a', 'Text')]);
const B = model([el('页b', 'Text')]);
const C = model([el('页c', 'Text')]);

describe('Navigator', () => {
  it('已在目标 → arrived(path 仅起点)', async () => {
    const g = graphOf([A], []);
    const nav = new Navigator(new ActExecutor(new FakeDevice([]), { stallMs: 0 }), g);
    const r = await nav.navigate(senseFor(A), { fingerprintHash: fpOf(A).skeletonHash }, cfg());
    expect(r.success).toBe(true);
    expect(r.reason).toBe('arrived');
  });

  it('无路径 → no-path', async () => {
    const g = graphOf([A, B], []);
    const nav = new Navigator(new ActExecutor(new FakeDevice([]), { stallMs: 0 }), g);
    const r = await nav.navigate(senseFor(A), { fingerprintHash: fpOf(B).skeletonHash }, cfg());
    expect(r.success).toBe(false);
    expect(r.reason).toBe('no-path');
  });

  it('沿路径 a→b→c 到达 c → arrived', async () => {
    const g = graphOf([A, B, C], [navEdge(fpOf(A).skeletonHash, fpOf(B).skeletonHash), navEdge(fpOf(B).skeletonHash, fpOf(C).skeletonHash)]);
    const dev = new FakeDevice([B, B, C, C], SIZE);   // 步1 perform after=B×2;步2 perform after=C×2
    const nav = new Navigator(new ActExecutor(dev, { stallMs: 0 }), g);
    const r = await nav.navigate(senseFor(A), { fingerprintHash: fpOf(C).skeletonHash }, cfg());
    expect(r.success).toBe(true);
    expect(r.reason).toBe('arrived');
    expect(r.traversed).toBe(2);
    expect(r.verified).toEqual([true, true]);
  });

  it('落点改版(重验仍不符)→ revision + 标边 verified=false', async () => {
    const X = model([el('乱七八糟', 'Text')]);
    const g = graphOf([A, B], [navEdge(fpOf(A).skeletonHash, fpOf(B).skeletonHash)]);
    const e = g.edges[0]!;
    const dev = new FakeDevice([X, X, X, X], SIZE);   // perform after=X×2,重验 senseStable=X×2
    const nav = new Navigator(new ActExecutor(dev, { stallMs: 0 }), g);
    const r = await nav.navigate(senseFor(A), { fingerprintHash: fpOf(B).skeletonHash }, cfg());
    expect(r.success).toBe(false);
    expect(r.reason).toBe('revision');
    expect(e.verified).toBe(false);
  });

  it('落点抖动 → 重验后命中 → arrived', async () => {
    const g = graphOf([A, B], [navEdge(fpOf(A).skeletonHash, fpOf(B).skeletonHash)]);
    const dev = new FakeDevice([C, C, B, B], SIZE);   // perform after=C×2(抖动),重验 senseStable=B×2 → 命中
    const nav = new Navigator(new ActExecutor(dev, { stallMs: 0 }), g);
    const r = await nav.navigate(senseFor(A), { fingerprintHash: fpOf(B).skeletonHash }, cfg());
    expect(r.success).toBe(true);
    expect(r.reason).toBe('arrived');
    expect(r.verified).toEqual([true]);
  });

  it('遇弹窗 → popup 中止', async () => {
    const withMask = model([
      el('页b', 'Text'),
      { ref: '@e9#s1', bounds: [0, 0, 1080, 2340], center: { x: 540, y: 1170 }, texts: [], attrs: { clickable: true, type: 'Stack' } },
    ]);
    const g = graphOf([A, B], [navEdge(fpOf(A).skeletonHash, fpOf(B).skeletonHash)]);
    const dev = new FakeDevice([withMask, withMask], SIZE);
    const nav = new Navigator(new ActExecutor(dev, { stallMs: 0 }), g);
    const r = await nav.navigate(senseFor(A), { fingerprintHash: fpOf(B).skeletonHash }, cfg());
    expect(r.success).toBe(false);
    expect(r.reason).toBe('popup');
  });
});
