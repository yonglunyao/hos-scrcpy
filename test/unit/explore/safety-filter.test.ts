import { describe, it, expect } from 'vitest';
import { classifySafety } from '../../../src/explore/safety-filter';
import type { Element } from '../../../src/screen-model';

function el(text: string, type = 'Button'): Element {
  return { ref: '@e0#s1', bounds: [0,0,100,100], center: {x:50,y:50}, texts: text ? [text] : [], attrs: { clickable: true, type } };
}

describe('classifySafety(全放行:去掉黑白名单)', () => {
  it('危险词也放行', () => {
    expect(classifySafety(el('删除')).allow).toBe(true);
    expect(classifySafety(el('立即支付')).allow).toBe(true);
    expect(classifySafety(el('退出登录')).allow).toBe(true);
  });
  it('任意 type/text 放行', () => {
    expect(classifySafety(el('', 'Image')).allow).toBe(true);
    expect(classifySafety(el('代理', 'Column')).allow).toBe(true);
    expect(classifySafety(el('推荐', 'ListItem')).allow).toBe(true);
    expect(classifySafety(el('返回')).allow).toBe(true);
  });
});
