import { describe, it, expect } from 'vitest';
import { detectPopup, stripPopup } from '../../../src/page-graph/popup';
import { computeFingerprint } from '../../../src/page-graph/fingerprint';
import type { FingerprintInput } from '../../../src/page-graph/types';

function el(type: string, bounds: number[], opts: { clickable?: boolean; text?: string } = {}): FingerprintInput['elements'][number] {
  return { ref: '@e0#s1', bounds, center: { x: (bounds[0]+bounds[2])/2, y: (bounds[1]+bounds[3])/2 }, texts: opts.text ? [opts.text] : [], attrs: { clickable: opts.clickable, type } };
}

describe('detectPopup', () => {
  it('无弹窗(普通页)→ null', () => {
    const input: FingerprintInput = { elements: [el('Text', [0,0,400,40]), el('Button', [10,500,200,560], {clickable:true, text:'确定'})], screenSize: { w: 400, h: 800 } };
    expect(detectPopup(input)).toBeNull();
  });
  it('全屏遮罩(归一化面积 ≥0.9 + clickable)→ 检出', () => {
    const input: FingerprintInput = { elements: [el('Text', [0,0,400,40]), el('Stack', [0,0,400,800], {clickable:true})], screenSize: { w: 400, h: 800 } };
    expect(detectPopup(input)).not.toBeNull();
  });
  it('type 含 dialog/sheet/popup/modal → 检出', () => {
    const input: FingerprintInput = { elements: [el('Dialog', [50,200,350,600]), el('Text', [0,0,400,40])], screenSize: { w: 400, h: 800 } };
    const p = detectPopup(input);
    expect(p).not.toBeNull();
    expect(p!.kind).toMatch(/dialog|sheet|popup|modal/);
  });
});

describe('stripPopup', () => {
  it('剥离弹窗控件树 + 遮罩,保留底层页', () => {
    const input: FingerprintInput = {
      elements: [
        el('Text', [0,0,400,40], {text:'底层标题'}),
        el('Button', [10,500,200,560], {clickable:true, text:'底层按钮'}),
        el('Stack', [0,0,400,800], {clickable:true}),          // 遮罩
        el('Dialog', [50,200,350,600]),                          // 弹窗容器
        el('Text', [60,220,340,260], {text:'弹窗内容'}),        // 弹窗子项
      ],
      screenSize: { w: 400, h: 800 },
    };
    const stripped = stripPopup(input);
    const texts = stripped.elements.flatMap((e) => e.texts);
    expect(texts).toContain('底层标题');
    expect(texts).toContain('底层按钮');
    expect(texts).not.toContain('弹窗内容');
  });

  it('无弹窗 → 原样返回', () => {
    const input: FingerprintInput = { elements: [el('Text', [0,0,400,40], {text:'页'})], screenSize: { w: 400, h: 800 } };
    expect(stripPopup(input).elements).toEqual(input.elements);
  });

  it('剥离后 computeFingerprint 与无弹窗同页一致(弹窗不污染指纹)', () => {
    const base: FingerprintInput = { elements: [el('Text',[0,0,400,40],{text:'页'}), el('Button',[10,500,200,560],{clickable:true,text:'确定'})], screenSize:{w:400,h:800} };
    const withPopup: FingerprintInput = { ...base, elements: [...base.elements, el('Stack',[0,0,400,800],{clickable:true}), el('Dialog',[50,200,350,600]), el('Text',[60,220,340,260],{text:'弹窗'})] };
    expect(computeFingerprint(stripPopup(withPopup)).skeletonHash).toBe(computeFingerprint(base).skeletonHash);
  });
});
