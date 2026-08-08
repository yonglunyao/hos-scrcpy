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
    // 屏 1000x2000(由 root 提供 screenArea 上界);click 是 100x50 的小控件
    const root = el({ type: 'Column', bounds: [0, 0, 1000, 2000] });
    const click = el({ clickable: true, type: 'Stack', bounds: [0, 0, 100, 50] });
    const label = el({ type: 'Text', text: 'WLAN', bounds: [0, 0, 40, 50] }); // 重叠
    const far = el({ type: 'Text', text: 'other', bounds: [200, 200, 240, 240] }); // 不重叠
    const result = associateText([root, click, label, far]);
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

  it('大 scrollable 容器(List 覆盖全屏)不收集几何重叠的全屏 text(渲染爆炸修复)', () => {
    // 屏 1000x2000;List 占满全屏,内含 20 个独立 Text 子节点
    const list = el({ scrollable: true, type: 'List', bounds: [0, 0, 1000, 2000] });
    const texts: UiElement[] = Array.from({ length: 20 }, (_, i) =>
      el({ type: 'Text', text: `item${i}`, bounds: [0, i * 100, 800, i * 100 + 80] }),
    );
    const result = associateText([list, ...texts]);
    const listEl = result.find((e) => e.attrs.scrollable);
    expect(listEl?.texts).toEqual([]); // 容器自身无 text,scrollable 不收集
  });

  it('大 clickable 容器(全屏 Swiper,面积 >= 25% 屏)不收集全屏 text', () => {
    // 屏 1000x2000;Swiper 占满全屏且 clickable,首页所有商品 Text 几何重叠
    const swiper = el({ clickable: true, type: 'Swiper', bounds: [0, 0, 1000, 2000] });
    const goods: UiElement[] = [
      el({ type: 'Text', text: '商品A', bounds: [0, 0, 500, 200] }),
      el({ type: 'Text', text: '商品B', bounds: [500, 0, 1000, 200] }),
      el({ type: 'Text', text: '商品C', bounds: [0, 1800, 500, 2000] }),
    ];
    const result = associateText([swiper, ...goods]);
    const sw = result.find((e) => e.attrs.clickable && e.attrs.type === 'Swiper');
    expect(sw?.texts).toEqual([]); // 大 clickable 也不收集
  });

  it('小 clickable 控件仍收集邻近 text(回归:修复不破坏正常关联)', () => {
    // 屏 1000x2000;一个 100x50 的小 clickable 控件 + 重叠的 Text 标签
    const click = el({ clickable: true, type: 'Stack', bounds: [10, 10, 110, 60] });
    const label = el({ type: 'Text', text: 'WLAN', bounds: [10, 10, 80, 60] }); // 重叠
    const far = el({ type: 'Text', text: 'far', bounds: [500, 500, 600, 550] }); // 不重叠
    // 加一个全屏根节点提供 screenArea 上界
    const root = el({ type: 'Column', bounds: [0, 0, 1000, 2000] });
    const result = associateText([root, click, label, far]);
    const c = result.find((e) => e.attrs.clickable);
    expect(c?.texts).toContain('WLAN');
    expect(c?.texts).not.toContain('far');
  });

  it('中等 clickable 容器(面积 < 25% 屏)仍收集重叠 text', () => {
    // 屏 1000x2000(屏面积 2,000,000);一个 400x300 = 120,000(6%) 的卡片
    const card = el({ clickable: true, type: 'Stack', bounds: [0, 0, 400, 300] });
    const label = el({ type: 'Text', text: '卡片标题', bounds: [10, 10, 380, 50] });
    const root = el({ type: 'Column', bounds: [0, 0, 1000, 2000] });
    const result = associateText([root, card, label]);
    const c = result.find((e) => e.attrs.clickable);
    expect(c?.texts).toContain('卡片标题');
  });
});
