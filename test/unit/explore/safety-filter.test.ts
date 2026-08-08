import { describe, it, expect } from 'vitest';
import { classifySafety } from '../../../src/explore/safety-filter';
import type { Element } from '../../../src/screen-model';

function el(text: string, type = 'Button'): Element {
  return { ref: '@e0#s1', bounds: [0,0,100,100], center: {x:50,y:50}, texts: text ? [text] : [], attrs: { clickable: true, type } };
}

describe('classifySafety', () => {
  it('黑名单危险词 → 拦(即便看起来像导航)', () => {
    expect(classifySafety(el('恢复出厂设置', 'Button')).allow).toBe(false);
    expect(classifySafety(el('退出登录', 'Button')).allow).toBe(false);
    expect(classifySafety(el('立即支付', 'Button')).allow).toBe(false);
    expect(classifySafety(el('删除', 'Image')).allow).toBe(false);
  });
  it('白名单:type 导航类(Tab/Navigation/Menu)放行 —— 覆盖纯图标', () => {
    const v = classifySafety(el('', 'Tab'));
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('whitelist-navigate');
  });
  it('白名单:text 探索目标类放行', () => {
    expect(classifySafety(el('设置')).allow).toBe(true);
    expect(classifySafety(el('关于手机')).allow).toBe(true);
    expect(classifySafety(el('更多')).allow).toBe(true);
  });
  it('控制类词(返回/关闭/取消)不在白名单 → 默认拒(回溯由 Explorer BACK 处理)', () => {
    expect(classifySafety(el('返回')).allow).toBe(false);
    expect(classifySafety(el('关闭')).allow).toBe(false);
    expect(classifySafety(el('取消')).allow).toBe(false);
  });
  it('白名单外默认拒(FAIL-SAFE)', () => {
    const v = classifySafety(el('', 'Image'));
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('default-deny');
  });
});
