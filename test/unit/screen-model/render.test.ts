import { describe, it, expect } from 'vitest';
import { renderModel } from '../../../src/screen-model/render';
import type { ScreenModel, Element } from '../../../src/screen-model/types';

const mk = (over: Partial<Element>): Element => ({ ref: '@e0#s1', bounds: [0,0,100,50], center: {x:50,y:25}, texts: [], attrs: {}, ...over });
const model = (els: Element[]): ScreenModel => ({ generation: 1, ts: 0, elements: els });

describe('renderModel', () => {
  it('渲染 @eN#sN [type] text', () => {
    const out = renderModel(model([mk({ ref: '@e1#s1', attrs: { type: 'Row', clickable: true }, texts: ['WLAN', '已连接'] })]));
    expect(out).toContain('@e1#s1 [Row] WLAN');
    expect(out).toContain('已连接');
  });
  it('scrollable 容器浅缩进子元素', () => {
    const out = renderModel(model([
      mk({ ref: '@e1#s1', attrs: { type: 'List', scrollable: true }, texts: [], bounds: [0,0,100,100] }),
      mk({ ref: '@e2#s1', attrs: { type: 'Row', clickable: true }, texts: ['蓝牙'], bounds: [0,0,100,20] }),
    ]));
    expect(out).toMatch(/@e1#s1.*\n\s+@e2#s1/);
  });
  it('省略 bounds', () => {
    const out = renderModel(model([mk({ ref: '@e1#s1', bounds: [10,20,30,40], texts: ['x'] })]));
    expect(out).not.toContain('10,20');
  });
  it('texts 超过 6 个时截断,只显示前 6 并追加 ...(+N)', () => {
    const texts = ['一', '二', '三', '四', '五', '六', '七', '八'];
    const out = renderModel(model([mk({ ref: '@e1#s1', attrs: { type: 'Row' }, texts })]));
    // 前 6 个应出现
    expect(out).toContain('一');
    expect(out).toContain('六');
    // 第 7、8 个不应出现
    expect(out).not.toContain('七');
    expect(out).not.toContain('八');
    // 截断标记:(8 - 6) = 2 个被截断
    expect(out).toContain('...(+2)');
  });
  it('texts 恰好 6 个时不截断(无 ...(+N) 标记)', () => {
    const texts = ['一', '二', '三', '四', '五', '六'];
    const out = renderModel(model([mk({ ref: '@e1#s1', attrs: { type: 'Row' }, texts })]));
    expect(out).not.toContain('...(+');
    expect(out).toContain('六');
  });
  it('texts 少于 6 个时正常显示全部', () => {
    const texts = ['主', '副1', '副2'];
    const out = renderModel(model([mk({ ref: '@e1#s1', attrs: { type: 'Row' }, texts })]));
    expect(out).toContain('主');
    expect(out).toContain('副1');
    expect(out).toContain('副2');
    expect(out).not.toContain('...(+');
  });
});
