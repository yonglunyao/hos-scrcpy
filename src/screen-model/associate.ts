import type { UiElement } from '../layout/types';
import type { Element } from './types';

const overlap = (a: number[], b: number[]) =>
  !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);

const area = (b: number[]) => (b[2]! - b[0]!) * (b[3]! - b[1]!);

/**
 * 大容器面积占比阈值:>= screenArea * LARGE_RATIO 视为结构容器,不收集重叠 text。
 * 取 0.25 —— 实测真机 2-pane 设置页(1920×2880)的侧栏 NavRouter 占 37.6% 屏面积却含 26 个菜单项,
 * 0.4 阈值会漏过它;0.25 能稳定区分"操作目标"(按钮/图标/卡片 < 20%)与"结构容器"(侧栏/列表/Swiper >= 25%)。
 */
const LARGE_RATIO = 0.25;

/**
 * 把 UiElement[] 关联成 Element[]:小可点击控件收入自身 text + 重叠邻近 text;
 * scrollable 容器与大 clickable 容器不收集(其文字在独立子 Text 节点,agent 看那些 @eN 即可)。
 */
export function associateText(els: UiElement[]): Element[] {
  const textNodes = els.filter(
    (e) => (e.text && e.text.trim()) || (e.originalText && e.originalText.trim()) || (e.description && e.description.trim()),
  );
  // 近似屏幕面积:取所有元素 bounds 的最大面积(全屏容器/根节点会上界逼近真实屏面积)
  let screenArea = 1;
  for (const e of els) {
    const a = area(e.bounds);
    if (a > screenArea) screenArea = a;
  }
  const largeThreshold = screenArea * LARGE_RATIO;
  return els
    .filter(
      (e) =>
        e.clickable ||
        e.scrollable ||
        (e.text && e.text.trim()) ||
        (e.hint && e.hint.trim()) ||
        (e.description && e.description.trim()),
    )
    .map((e): Element => {
      const texts: string[] = [];
      const self = e.text?.trim() || e.originalText?.trim() || e.description?.trim();
      if (self) texts.push(self);
      // 仅小可点击控件收集重叠 text:scrollable 容器是结构不收集;大 clickable(全屏 Swiper)也不收集
      if (!self && e.clickable && area(e.bounds) < largeThreshold) {
        for (const t of textNodes) {
          const tt = t.text?.trim() || t.originalText?.trim() || t.description?.trim();
          if (tt && overlap(e.bounds, t.bounds) && !texts.includes(tt)) texts.push(tt);
        }
      }
      return {
        ref: '', // 由 buildScreenModel 分配
        bounds: e.bounds,
        center: e.center,
        texts,
        ...(e.hint ? { hint: e.hint } : {}),
        attrs: {
          ...(e.clickable ? { clickable: true } : {}),
          ...(e.scrollable ? { scrollable: true } : {}),
          ...(e.enabled !== undefined ? { enabled: e.enabled } : {}),
          ...(e.type ? { type: e.type } : {}),
        },
      };
    });
}
