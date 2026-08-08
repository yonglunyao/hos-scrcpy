import type { FingerprintInput } from './types';

export interface PopupInfo {
  kind: string;            // dialog/sheet/popup/modal/mask
  maskBounds?: number[];
}

const POPUP_TYPE = /dialog|sheet|popup|modal|menu/i;
const MASK_AREA_RATIO = 0.9;   // 全屏遮罩:归一化面积 ≥0.9

/** 弹窗结构性检测:顶层 dialog/sheet/popup type 或全屏半透明遮罩。不靠 text。 */
export function detectPopup(input: FingerprintInput): PopupInfo | null {
  const { w, h } = input.screenSize ?? deriveSize(input);
  const screenArea = w * h;

  const mask = input.elements.find((e) => {
    const a = area(e.bounds);
    return e.attrs.clickable && a / screenArea >= MASK_AREA_RATIO;
  });
  if (mask) return { kind: 'mask', maskBounds: mask.bounds };

  const popup = input.elements.find((e) => POPUP_TYPE.test(e.attrs.type ?? ''));
  if (popup) return { kind: (popup.attrs.type ?? 'popup').toLowerCase() };

  return null;
}

/**
 * 弹窗剥离:移除遮罩 + 弹窗控件子树,返回底层页 input。
 *
 * 遮罩(全屏半透明覆盖层)仅按精确 bounds 移除自身 —— 它几何上罩住全屏,但底层页
 * 并非其子项,不能用几何包含判断否则会把整页一并删掉。弹窗容器(dialog/sheet/…)
 * 则移除自身 + 几何包含的子项(弹窗内的文本/按钮等)。
 *
 * 关键不变量(spec §4.2/§4.6):剥离后 computeFingerprint 与无弹窗同页一致,
 * 即弹窗出现与否指纹不变。
 */
export function stripPopup(input: FingerprintInput): FingerprintInput {
  const popup = detectPopup(input);
  if (!popup) return input;

  // 弹窗容器 bounds:type 命中 POPUP_TYPE 的元素,移除自身 + 几何包含子项
  const popupContainerBounds: number[][] = [];
  for (const e of input.elements) {
    if (POPUP_TYPE.test(e.attrs.type ?? '')) popupContainerBounds.push(e.bounds);
  }

  const elements = input.elements.filter((e) => {
    // 遮罩:仅精确匹配自身(sameBounds)。遮罩几何覆盖全屏,底层页不是其子项,
    // 若用 isInside 会误删整页。
    if (popup.maskBounds && sameBounds(e.bounds, popup.maskBounds)) return false;
    // 弹窗容器:自身 + 几何包含子项
    if (popupContainerBounds.some((rb) => sameBounds(e.bounds, rb))) return false;
    if (popupContainerBounds.some((rb) => isInside(e.bounds, rb))) return false;
    return true;
  });

  return { ...input, elements };
}

function sameBounds(a: number[], b: number[]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function isInside(child: number[], parent: number[]): boolean {
  return child[0] >= parent[0] && child[1] >= parent[1] && child[2] <= parent[2] && child[3] <= parent[3];
}

function area(b: number[]): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

function deriveSize(input: FingerprintInput): { w: number; h: number } {
  let maxR = 1, maxB = 1;
  for (const e of input.elements) { maxR = Math.max(maxR, e.bounds[2]); maxB = Math.max(maxB, e.bounds[3]); }
  return { w: maxR, h: maxB };
}
