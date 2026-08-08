import { describe, it, expect } from 'vitest';
import { resolveLocator } from '../../../src/screen-model/locator';
import type { ScreenModel, Element, Locator } from '../../../src/screen-model/types';

const mk = (over: Partial<Element>): Element => ({ ref: '@e0#s1', bounds: [0,0,100,50], center: {x:50,y:25}, texts: [], attrs: {}, ...over });
const model = (els: Element[]): ScreenModel => ({ generation: 1, ts: 0, elements: els });

describe('resolveLocator', () => {
  it('按 text contains 匹配(默认)', () => {
    const m = model([mk({ texts: ['WLAN'] }), mk({ texts: ['蓝牙'] })]);
    expect(resolveLocator(m, { text: 'WL' })?.texts[0]).toBe('WLAN');
  });
  it('text equals 精确匹配', () => {
    const m = model([mk({ texts: ['WLAN'] }), mk({ texts: ['WLAN已连接'] })]);
    expect(resolveLocator(m, { text: 'WLAN', textMode: 'equals' })?.texts[0]).toBe('WLAN');
  });
  it('多匹配时 index 取第 N 个', () => {
    const m = model([mk({ texts: ['商品'] }), mk({ texts: ['商品'] }), mk({ texts: ['商品'] })]);
    expect(resolveLocator(m, { text: '商品', index: 1 })?.ref).toBe(m.elements[1]!.ref);
  });
  it('未匹配返回 undefined(走坐标兜底)', () => {
    const m = model([mk({ texts: ['WLAN'] })]);
    expect(resolveLocator(m, { text: '不存在' })).toBeUndefined();
  });
  it('hint 匹配输入框空态', () => {
    const m = model([mk({ hint: '搜索设置项', attrs: { type: 'SearchField' } })]);
    expect(resolveLocator(m, { hint: '搜索' })?.hint).toBe('搜索设置项');
  });
});
