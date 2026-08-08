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

function area(b: number[]): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

function deriveSize(input: FingerprintInput): { w: number; h: number } {
  let maxR = 1, maxB = 1;
  for (const e of input.elements) { maxR = Math.max(maxR, e.bounds[2]); maxB = Math.max(maxB, e.bounds[3]); }
  return { w: maxR, h: maxB };
}
