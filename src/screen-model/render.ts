import type { ScreenModel } from './types';

const contains = (outer: number[], inner: number[]) =>
  inner[0]! >= outer[0]! && inner[1]! >= outer[1]! && inner[2]! <= outer[2]! && inner[3]! <= outer[3]!;

/** texts 渲染最多 6 个,超出追加 ...(+N) 截断标记,防大容器/偶发关联炸成超长行。 */
const TEXT_LIMIT = 6;

/** 渲染给 agent 的紧凑文本:@eN [type] text → result;scrollable 容器浅缩进;省 bounds。 */
export function renderModel(model: ScreenModel): string {
  const lines: string[] = [`=== screen gen=${model.generation} (${model.elements.length} elements) ===`];
  const containers = model.elements.filter((e) => e.attrs.scrollable);
  const childOf: Record<number, number | undefined> = {};
  model.elements.forEach((e, i) => {
    const parent = containers.findIndex((c) => c !== e && contains(c.bounds, e.bounds));
    if (parent >= 0) childOf[i] = parent;
  });
  model.elements.forEach((e, i) => {
    const indent = childOf[i] !== undefined ? '  ' : '';
    const role = e.attrs.type ?? '?';
    const main = e.texts[0] ?? (e.hint ? `(${e.hint})` : '');
    const rest = e.texts.slice(1, TEXT_LIMIT).join(' / ');
    const overflow = e.texts.length > TEXT_LIMIT ? ` ...(+${e.texts.length - TEXT_LIMIT})` : '';
    const tail = rest || overflow ? ` → ${rest}${overflow}` : '';
    lines.push(`${indent}${e.ref} [${role}] ${main}${tail}`);
  });
  return lines.join('\n');
}
