import { describe, it, expect } from 'vitest';
import { associateText } from '../../../src/screen-model/associate';
import type { UiElement } from '../../../src/layout/types';

const el = (over: Partial<UiElement>): UiElement => ({ bounds: [0,0,100,50], center: {x:50,y:25}, ...over });

describe('associateText', () => {
  it('可点击控件本身有 text 时收入 texts', () => {
    const click = el({ clickable: true, text: '登录', bounds: [0,0,100,50] });
    const result = associateText([click]);
    expect(result[0].texts).toContain('登录');
  });

  it('可点击控件无 text 时,纳入 bounds 重叠的邻近 text 节点', () => {
    const click = el({ clickable: true, type: 'Stack', bounds: [0,0,100,50] });
    const label = el({ type: 'Text', text: 'WLAN', bounds: [0,0,40,50] }); // 重叠
    const far = el({ type: 'Text', text: 'other', bounds: [200,200,240,240] }); // 不重叠
    const result = associateText([click, label, far]);
    const c = result.find((e) => e.attrs.clickable);
    expect(c?.texts).toContain('WLAN');
    expect(c?.texts).not.toContain('other');
  });

  it('非可点击、无 text 的元素不出现在结果中(过滤纯容器)', () => {
    const container = el({ type: 'Stack', bounds: [0,0,100,100] });
    expect(associateText([container]).length).toBe(0);
  });

  it('可点击控件仅有 description 时收入 texts(self 三选一兜底)', () => {
    const click = el({ clickable: true, type: 'Image', description: '返回按钮' });
    const result = associateText([click]);
    expect(result[0].texts).toContain('返回按钮');
  });
});
