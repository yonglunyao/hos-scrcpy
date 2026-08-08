import type { UiElement } from '../layout/types';
import type { Element } from './types';

const overlap = (a: number[], b: number[]) =>
  !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);

/** 把 UiElement[] 关联成 Element[]:可点击控件收入自身 text + 重叠邻近 text;过滤无 text 的纯容器。 */
export function associateText(els: UiElement[]): Element[] {
  const textNodes = els.filter(
    (e) => (e.text && e.text.trim()) || (e.originalText && e.originalText.trim()) || (e.description && e.description.trim()),
  );
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
      if (!self && (e.clickable || e.scrollable)) {
        // 无自身 text 的可交互控件:纳入 bounds 重叠的邻近 text(子树/邻近都靠几何重叠近似,因 flatten 已压平)
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
