import { describe, it, expect } from 'vitest';
import { extractFrontier, locatorSignature } from '../../../src/explore/frontier';
import { classifySafety } from '../../../src/explore/safety-filter';
import type { ScreenModel, Element } from '../../../src/screen-model';

function el(text: string, type: string, bounds: number[]): Element {
  return { ref: `@e${text.length}%s1`, bounds, center: { x:(bounds[0]+bounds[2])/2, y:(bounds[1]+bounds[3])/2 }, texts: text?[text]:[], attrs: { clickable: true, type } };
}
function sm(els: Element[]): ScreenModel { return { generation: 1, ts: 1, elements: els }; }

describe('frontier', () => {
  it('locatorSignature 稳定去重', () => {
    expect(locatorSignature({ text: '设置' })).toBe(locatorSignature({ text: '设置' }));
    expect(locatorSignature({ text: '设置' })).not.toBe(locatorSignature({ text: '关于' }));
  });

  it('提取可点候选:白名单放行 / 黑名单危险跳过(记 dangerous)/ 默认拒不计入', () => {
    const m = sm([
      el('设置', 'Text', [0,0,1080,100]),
      el('恢复出厂', 'Button', [0,100,540,200]),
      el('关于手机', 'Button', [0,200,540,300]),
      el('', 'Image', [0,300,540,400]),
    ]);
    const r = extractFrontier(m, { exploredSignatures: new Set(), safety: classifySafety, sampleLimit: 10 });
    expect(r.selected.length).toBe(2);
    expect(r.dangerous).toBe(1);
    expect(r.totalCandidates).toBe(2);
  });

  it('已 explored 的 signature 跳过', () => {
    const m = sm([el('设置', 'Text', [0,0,1080,100]), el('关于手机', 'Button', [0,200,540,300])]);
    const r = extractFrontier(m, { exploredSignatures: new Set([locatorSignature({ text: '设置' })]), safety: classifySafety, sampleLimit: 10 });
    expect(r.selected.map((c) => c.locator.text)).toEqual(['关于手机']);
  });

  it('优先级:navigate 关键词(type Tab)排在前面', () => {
    const m = sm([
      el('关于手机', 'Button', [0,200,540,300]),
      el('显示', 'Tab', [0,2200,540,2340]),
    ]);
    const r = extractFrontier(m, { exploredSignatures: new Set(), safety: classifySafety, sampleLimit: 10 });
    expect(r.selected[0]!.locator.text).toBe('显示');
  });

  it('抽样:超 sampleLimit 取前 N,记 sampledOut', () => {
    const m = sm(Array.from({ length: 5 }, (_, i) => el(`设置${i}`, 'Text', [0, i*100, 540, i*100+100])));
    const r = extractFrontier(m, { exploredSignatures: new Set(), safety: classifySafety, sampleLimit: 2 });
    expect(r.selected.length).toBe(2);
    expect(r.sampledOut).toBe(3);
  });

  it('候选带 fallbackCoord(=元素 center)', () => {
    const m = sm([el('设置', 'Text', [0,0,1080,100])]);
    const r = extractFrontier(m, { exploredSignatures: new Set(), safety: classifySafety, sampleLimit: 10 });
    expect(r.selected[0]!.fallbackCoord).toEqual({ x: 540, y: 50 });
  });
});
