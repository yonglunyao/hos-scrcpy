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

  it('过滤状态栏噪声(归一后 NUM/TIME/符号占位被丢弃),保留语义词', () => {
    // 顶部 5% 带罩住状态栏:时间/电量/网速归一后是 NUM/TIME/NUM:NUM 等无语义占位;
    // 标题栏"设置"是有语义词,必须保留。见 spike §6(49% anchors 是状态栏噪声)。
    const input: FingerprintInput = {
      elements: [
        el('设置', 0, 'Text'),     // 语义词(CJK)→ 保留
        el('10:24', 0, 'Text'),    // 时间 → 归一 TIME → 无语义 → 滤
        el('100', 0, 'Text'),      // 纯数字 → NUM → 滤
        el(':', 0, 'Text'),        // 纯符号 → 滤
      ],
      screenSize: { w: 400, h: 800 },
    };
    const anchors = extractAnchors(input);
    expect(anchors).toContain('设置');
    expect(anchors).not.toContain('NUM');
    expect(anchors).not.toContain('TIME');
    expect(anchors).not.toContain(':');
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
  it('hash miss + Jaccard≥T 但 margin<Δ → new(margin 不足不算 drift)', () => {
    expect(classifyMatch({ exactHashHit: false, jaccard: 0.9, margin: 0.1 })).toBe('new');
  });
  it('精确边界 jaccard=T=0.6 且 margin=Δ=0.2 → drift(>= 含等号)', () => {
    // 闭区间:恰好等于阈值也算 drift(>=),不应退化到 new。
    expect(classifyMatch({ exactHashHit: false, jaccard: 0.6, margin: 0.2 })).toBe('drift');
  });
  it('精确边界 jaccard=T 但 margin=Δ-ε → new(margin 不足)', () => {
    expect(classifyMatch({ exactHashHit: false, jaccard: 0.6, margin: 0.199999 })).toBe('new');
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

  it('透传 staticWhitelist:白名单文本保留不归一(规则②时序学习接入管线)', () => {
    // '12条' 不带白名单 → 'NUM条';带白名单 → '12条' 保留。两者 skeletonHash 必不同。
    const input: FingerprintInput = { elements: [el('12条', 0)], screenSize: { w: 400, h: 800 } };
    const withoutWl = computeFingerprint(input);
    const withWl = computeFingerprint(input, { staticWhitelist: new Set(['12条']) });
    expect(withoutWl.skeletonHash).not.toBe(withWl.skeletonHash);
    // 白名单缺省时向后兼容:与不传 opts 行为一致
    const withEmptyOpts = computeFingerprint(input, {});
    expect(withEmptyOpts.skeletonHash).toBe(withoutWl.skeletonHash);
  });
});
