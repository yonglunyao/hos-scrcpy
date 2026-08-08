import { describe, it, expect } from 'vitest';
import { extractAnchors, matchAnchors, classifyMatch, computeFingerprint } from '../../../src/page-graph/fingerprint';
import type { FingerprintInput } from '../../../src/page-graph/types';

function el(text: string, y: number, type = 'Text'): FingerprintInput['elements'][number] {
  return { ref: '@e0#s1', bounds: [0, y, 400, y + 40], center: { x: 200, y: y + 20 }, texts: [text], attrs: { type } };
}

describe('extractAnchors', () => {
  it('取顶部/底部 5% 带内 Text/Tab/Header 的 text(已动态归一)', () => {
    const input: FingerprintInput = {
      elements: [el('设置', 0, 'Text'), el('内容', 400, 'Text'), el('我的', 760, 'Tab')],
      screenSize: { w: 400, h: 800 },
    };
    const anchors = extractAnchors(input);
    expect(anchors).toContain('设置');   // 顶部
    expect(anchors).toContain('我的');   // 底部
    expect(anchors).not.toContain('内容'); // 中部不计
  });
});

describe('matchAnchors (Jaccard)', () => {
  it('完全相同 = 1', () => {
    expect(matchAnchors(['设置', '关于'], ['设置', '关于'])).toBe(1);
  });
  it('部分重叠 = 交集/并集', () => {
    expect(matchAnchors(['设置', '关于'], ['设置', '显示'])).toBeCloseTo(1 / 3);
  });
  it('两边都空 = 1(视为同)', () => {
    expect(matchAnchors([], [])).toBe(1);
  });
});

describe('classifyMatch (漂移处置表)', () => {
  it('精确命中 → same', () => {
    expect(classifyMatch({ exactHashHit: true })).toBe('same');
  });
  it('hash miss + Jaccard≥T + margin≥Δ → drift(疑似已知页漂移)', () => {
    expect(classifyMatch({ exactHashHit: false, jaccard: 0.9, margin: 0.6 })).toBe('drift');
  });
  it('hash miss + 低 Jaccard → new(新页)', () => {
    expect(classifyMatch({ exactHashHit: false, jaccard: 0.2, margin: 0.1 })).toBe('new');
  });
});

describe('computeFingerprint', () => {
  it('同输入同 skeletonHash(确定性);含 version + anchors', () => {
    const input: FingerprintInput = { elements: [el('关于手机', 0)], screenSize: { w: 400, h: 800 } };
    const a = computeFingerprint(input);
    const b = computeFingerprint(input);
    expect(a.skeletonHash).toBe(b.skeletonHash);
    expect(a.version).toBe('v1');
    expect(Array.isArray(a.anchors)).toBe(true);
  });
});
