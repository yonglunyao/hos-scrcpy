export type ElementRole = 'button' | 'text' | 'input' | 'image' | 'link' | 'list' | 'container' | 'unknown';

export interface Element {
  ref: string;            // '@eN#sN' — 元素序号 + snapshot 代际
  bounds: number[];       // [l,t,r,b]
  center: { x: number; y: number };
  texts: string[];        // 关联文字(子树 + 重叠邻近)
  hint?: string;
  attrs: {
    clickable?: boolean;
    scrollable?: boolean;
    enabled?: boolean;
    type?: string;        // 原始 type(role 用 type 代替,不强行推断 role)
  };
}

export interface ScreenModel {
  generation: number;     // snapshot 代际(单调递增)
  ts: number;
  elements: Element[];
}

export type TextMode = 'equals' | 'contains' | 'regex';

export interface Locator {
  text?: string;
  textMode?: TextMode;    // 默认 contains
  hint?: string;
  within?: Locator;       // 几何包含近似父子
  index?: number;         // 多匹配时取第 index 个(0-based)
  enabled?: boolean;
}
