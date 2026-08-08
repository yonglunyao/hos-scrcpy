import { describe, it, expect } from 'vitest';
import { normalizeSkeleton, bucketize } from '../../../src/page-graph/normalize';
import type { FingerprintInput } from '../../../src/page-graph/types';

// 类型化 helper(避免裸 any)。元素需符合 FingerprintInput.elements:Element & {checked?}
function el(text: string, type = 'Button', opts: { clickable?: boolean; scrollable?: boolean; checked?: boolean } = {}): FingerprintInput['elements'][number] {
  return {
    ref: '@e0#s1', bounds: [0, 0, 100, 100], center: { x: 50, y: 50 },
    texts: [text], attrs: { clickable: opts.clickable ?? true, scrollable: opts.scrollable, type },
    checked: opts.checked,
  };
}

describe('normalizeSkeleton', () => {
  it('规则⑤:开关 checked-state 文本归一(toggle 不污染指纹)', () => {
    const off = normalizeSkeleton({ elements: [el('已关闭', 'Text', { checked: false })] });
    const on = normalizeSkeleton({ elements: [el('已开启', 'Text', { checked: true })] });
    expect(JSON.stringify(off.nodes)).toBe(JSON.stringify(on.nodes));
  });

  it('规则①:列表项 multiset 顺序无关', () => {
    const a = normalizeSkeleton({ elements: [
      el('列表', 'List', { scrollable: true }),
      el('项A', 'Text'), el('项B', 'Text'), el('项C', 'Text'),
    ]});
    const b = normalizeSkeleton({ elements: [
      el('列表', 'List', { scrollable: true }),
      el('项C', 'Text'), el('项A', 'Text'), el('项B', 'Text'),
    ]});
    expect(JSON.stringify(a.lists)).toBe(JSON.stringify(b.lists));
  });

  it('bucketize 容量桶', () => {
    expect(bucketize(1)).toBe('1');
    expect(bucketize(3)).toBe('2-5');
    expect(bucketize(15)).toBe('6-20');
    expect(bucketize(50)).toBe('21-100');
    expect(bucketize(200)).toBe('100+');
  });

  it('规则③:广告位无条件剥离(在场/不在场同骨架)', () => {
    const withAd = normalizeSkeleton({ elements: [el('内容', 'Text'), el('广告', 'Text')] });
    const noAd = normalizeSkeleton({ elements: [el('内容', 'Text')] });
    expect(JSON.stringify(withAd.nodes)).toBe(JSON.stringify(noAd.nodes));
  });
});

describe('normalizeSkeleton 补充', () => {
  it('bucketize 边界稳定(长度变化不跨桶则桶不变)', () => {
    // 下界归属:2 与 5 同桶,6 与 20 同桶,21 与 100 同桶
    expect(bucketize(2)).toBe('2-5');
    expect(bucketize(5)).toBe('2-5');
    expect(bucketize(6)).toBe('6-20');
    expect(bucketize(20)).toBe('6-20');
    expect(bucketize(21)).toBe('21-100');
    expect(bucketize(100)).toBe('21-100');
    expect(bucketize(101)).toBe('100+');
    // 0 与 1 同桶(空/单元素列表)
    expect(bucketize(0)).toBe('1');
  });

  it('规则③:不同措辞的广告位都剥离(推广/sponsor/AD)', () => {
    const baseline = normalizeSkeleton({ elements: [el('正文', 'Text')] });
    const variants = ['推广', 'sponsor', 'AD', 'Sponsor'];
    for (const marker of variants) {
      const withAd = normalizeSkeleton({ elements: [el('正文', 'Text'), el(marker, 'Text')] });
      expect(JSON.stringify(withAd.nodes), `marker=${marker}`).toBe(JSON.stringify(baseline.nodes));
    }
  });

  it('规则①:列表项 multiset 含重复项也顺序无关', () => {
    const a = normalizeSkeleton({ elements: [
      el('列表', 'List', { scrollable: true }),
      el('项A', 'Text'), el('项A', 'Text'), el('项B', 'Text'),
    ]});
    const b = normalizeSkeleton({ elements: [
      el('列表', 'List', { scrollable: true }),
      el('项B', 'Text'), el('项A', 'Text'), el('项A', 'Text'),
    ]});
    expect(JSON.stringify(a.lists)).toBe(JSON.stringify(b.lists));
  });

  it('规则②:动态值归一(数字/时间/日期粗筛)', () => {
    // 数字归一:不同点赞数同骨架
    const a = normalizeSkeleton({ elements: [el('点赞 42', 'Text')] });
    const b = normalizeSkeleton({ elements: [el('点赞 1,024', 'Text')] });
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));
  });
});
