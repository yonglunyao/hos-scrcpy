import { describe, it, expect } from 'vitest';
import { detectPopup } from '../../../src/page-graph/popup';
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
