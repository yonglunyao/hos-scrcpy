import type { ScreenModel, Element, Locator } from './types';

function matchText(target: string | undefined, query: string, mode: Locator['textMode']): boolean {
  if (!target) return false;
  if (mode === 'equals') return target === query;
  if (mode === 'regex') { try { return new RegExp(query).test(target); } catch { return false; } }
  return target.includes(query); // 默认 contains
}

/** 按 Locator 在当前 ScreenModel 解析元素(精确 bounds,每次现算)。未匹配返回 undefined。 */
export function resolveLocator(model: ScreenModel, loc: Locator): Element | undefined {
  // 提取到本地常量,保持闭包内类型窄化(loc.text/hint 在 .some() 回调里会丢失窄化)
  const qText = loc.text;
  const qHint = loc.hint;
  const qMode = loc.textMode;
  let cands = model.elements.filter((e) => {
    if (qText && !matchText(e.texts[0], qText, qMode) && !e.texts.some((t) => matchText(t, qText, qMode))) return false;
    if (qHint && !(e.hint && e.hint.includes(qHint))) return false;
    if (loc.enabled !== undefined && e.attrs.enabled !== loc.enabled) return false;
    return true;
  });
  if (loc.within) {
    const parent = resolveLocator(model, loc.within);
    if (!parent) return undefined;
    const pb = parent.bounds;
    cands = cands.filter((e) => e !== parent && e.bounds[0]! >= pb[0]! && e.bounds[1]! >= pb[1]! && e.bounds[2]! <= pb[2]! && e.bounds[3]! <= pb[3]!);
  }
  if (cands.length === 0) return undefined;
  const idx = loc.index ?? 0;
  return cands[Math.min(idx, cands.length - 1)];
}
