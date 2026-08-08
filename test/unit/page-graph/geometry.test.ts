import { describe, it, expect } from 'vitest';
import { geometrySignature } from '../../../src/page-graph/geometry';
import type { FingerprintInput } from '../../../src/page-graph/types';

function iconEl(x: number, y: number, bounds: number[] = [0, 0, 50, 50]): FingerprintInput['elements'][number] {
  return { ref: '@e0#s1', bounds, center: { x, y }, texts: [], attrs: { clickable: true, type: 'Image' } };
}

describe('geometrySignature', () => {
  it('纯图标页(text 缺失)产出几何签名;同布局同签名', () => {
    const icons = [iconEl(50, 50), iconEl(150, 50)];
    const a = geometrySignature({ elements: icons, screenSize: { w: 400, h: 800 } });
    const b = geometrySignature({ elements: icons, screenSize: { w: 400, h: 800 } });
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it('不同布局不同签名', () => {
    const l1 = [iconEl(25, 25)];
    const l2 = [iconEl(225, 225)];
    expect(geometrySignature({ elements: l1, screenSize: { w: 400, h: 800 } }))
      .not.toBe(geometrySignature({ elements: l2, screenSize: { w: 400, h: 800 } }));
  });

  it('顺序无关(排序后确定性)', () => {
    const a = geometrySignature({ elements: [iconEl(50, 50), iconEl(150, 50)], screenSize: { w: 400, h: 800 } });
    const b = geometrySignature({ elements: [iconEl(150, 50), iconEl(50, 50)], screenSize: { w: 400, h: 800 } });
    expect(a).toBe(b);
  });

  it('screenSize 缺省时按 bounds 推导(不抛错)', () => {
    const sig = geometrySignature({ elements: [iconEl(25, 25, [0, 0, 100, 200])] });
    expect(sig).toBeTruthy();
  });

  it('无可点控件 → 空签名', () => {
    const sig = geometrySignature({ elements: [], screenSize: { w: 400, h: 800 } });
    expect(sig).toBe('');
  });

  it('有 text 的控件不参与几何签名(仅纯图标计入)', () => {
    const withText: FingerprintInput['elements'][number] = {
      ref: '@e1#s1', bounds: [0, 0, 50, 50], center: { x: 50, y: 50 },
      texts: ['按钮'], attrs: { clickable: true, type: 'Button' },
    };
    const icon = iconEl(150, 150);
    const sig = geometrySignature({ elements: [withText, icon], screenSize: { w: 400, h: 800 } });
    // 只有图标(150,150)进入桶(x=floor(150/400*8)=3, y=floor(150/800*8)=1);带 text 的(50,50)被排除
    expect(sig).toBe('3,1');
  });
});
