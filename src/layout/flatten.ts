import type { UiElement } from './types';

function parseBoundsStr(s: string): number[] | undefined {
  const m = s.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  return m ? [+m[1], +m[2], +m[3], +m[4]] : undefined;
}
function strAttr(attrs: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) { const v = attrs[k]; if (typeof v === 'string' && v.trim() !== '') return v; }
  return undefined;
}
const isTrue = (v: unknown) => v === 'true';

export function flattenLayout(layoutStr: string): UiElement[] {
  let root: unknown;
  try { root = JSON.parse(layoutStr); } catch { return []; }
  const out: UiElement[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const attrs = obj.attributes && typeof obj.attributes === 'object' ? obj.attributes as Record<string, unknown> : undefined;
    if (attrs) {
      const bounds = typeof attrs.bounds === 'string' ? parseBoundsStr(attrs.bounds) : undefined;
      if (bounds) {
        const text = strAttr(attrs, ['text']);
        const originalText = strAttr(attrs, ['originalText']);
        const description = strAttr(attrs, ['description']);
        const id = strAttr(attrs, ['id']);
        const key = strAttr(attrs, ['key']);
        const type = strAttr(attrs, ['type']);
        const hint = strAttr(attrs, ['hint']);
        const clickable = isTrue(attrs.clickable);
        const scrollable = isTrue(attrs.scrollable);
        if (text || originalText || id || key || clickable || scrollable || hint) {
          const el: UiElement = {
            bounds,
            center: { x: Math.round((bounds[0]! + bounds[2]!) / 2), y: Math.round((bounds[1]! + bounds[3]!) / 2) },
          };
          if (text) el.text = text;
          if (originalText) el.originalText = originalText;
          if (description) el.description = description;
          if (id) el.id = id;
          if (key) el.key = key;
          if (type) el.type = type;
          if (hint) el.hint = hint;
          if (clickable) el.clickable = true;
          if (scrollable) el.scrollable = true;
          if (attrs.enabled !== undefined) el.enabled = isTrue(attrs.enabled);
          if (attrs.checkable !== undefined) el.checkable = isTrue(attrs.checkable);
          if (attrs.checked !== undefined) el.checked = isTrue(attrs.checked);
          out.push(el);
        }
      }
    }
    if (Array.isArray(obj.children)) obj.children.forEach(visit);
  };
  visit(root);
  return out;
}
