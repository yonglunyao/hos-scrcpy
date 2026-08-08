import type { FingerprintInput } from './types';

/** 网格分桶粒度(8×8)。 */
const GRID = 8;

/**
 * 纯图标页几何布局签名:可点控件(text 缺失)的归一化中心坐标分桶(8×8),
 * 排序后确定性拼接。text 缺失时指纹骨架退化为 type+层级会假合并,此签名补布局维度。
 *
 * 触发条件:见 normalizeSkeleton —— 所有 node 都无 text 时才填 geometry。
 */
export function geometrySignature(input: FingerprintInput): string {
  const { w, h } = input.screenSize ?? deriveSize(input);
  const cells = input.elements
    .filter((e) => e.attrs.clickable && (e.texts.length === 0 || e.texts.every((t) => !t)))
    .map((e) => `${Math.floor((e.center.x / w) * GRID)},${Math.floor((e.center.y / h) * GRID)}`)
    .sort();
  return cells.join('|');
}

/** screenSize 缺省时按所有元素 bounds 的最大右下角推导,保证归一化坐标 ∈ [0, GRID]。 */
function deriveSize(input: FingerprintInput): { w: number; h: number } {
  let maxR = 1;
  let maxB = 1;
  for (const e of input.elements) {
    maxR = Math.max(maxR, e.bounds[2]);
    maxB = Math.max(maxB, e.bounds[3]);
  }
  return { w: maxR, h: maxB };
}
