import { describe, it, expect } from 'vitest';
import { renderModel } from '../../../src/screen-model/render';
import type { ScreenModel, Element } from '../../../src/screen-model/types';

const mk = (over: Partial<Element>): Element => ({ ref: '@e0#s1', bounds: [0,0,100,50], center: {x:50,y:25}, texts: [], attrs: {}, ...over });
const model = (els: Element[]): ScreenModel => ({ generation: 1, ts: 0, elements: els });

describe('renderModel', () => {
  it('渲染 @eN [type] text', () => {
    const out = renderModel(model([mk({ ref: '@e1#s1', attrs: { type: 'Row', clickable: true }, texts: ['WLAN', '已连接'] })]));
    expect(out).toContain('@e1 [Row] WLAN');
    expect(out).toContain('已连接');
  });
  it('scrollable 容器浅缩进子元素', () => {
    const out = renderModel(model([
      mk({ ref: '@e1#s1', attrs: { type: 'List', scrollable: true }, texts: [], bounds: [0,0,100,100] }),
      mk({ ref: '@e2#s1', attrs: { type: 'Row', clickable: true }, texts: ['蓝牙'], bounds: [0,0,100,20] }),
    ]));
    expect(out).toMatch(/@e1.*\n\s+@e2/);
  });
  it('省略 bounds', () => {
    const out = renderModel(model([mk({ ref: '@e1#s1', bounds: [10,20,30,40], texts: ['x'] })]));
    expect(out).not.toContain('10,20');
  });
});
