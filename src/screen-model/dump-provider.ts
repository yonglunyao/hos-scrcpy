import { flattenLayout } from '../layout';
import { associateText } from './associate';
import type { ScreenModel, Element } from './types';

let generation = 0;

/** 从 dumpLayout JSON 构建 ScreenModel:flatten → associateText → 分配 @eN#sN。 */
export function buildScreenModel(layoutJson: string): ScreenModel {
  const gen = ++generation;
  const elements = associateText(flattenLayout(layoutJson)).map((e, i): Element => ({
    ...e,
    ref: `@e${i}#s${gen}`,
  }));
  return { generation: gen, ts: Date.now(), elements };
}

/** 解析 ref 字符串为 { idx, gen }(用于 act 校验)。 */
export function parseRef(ref: string): { idx: number; gen: number } | undefined {
  const m = ref.match(/^@e(\d+)#s(\d+)$/);
  return m ? { idx: +m[1], gen: +m[2] } : undefined;
}

/** 仅用于测试:重置代际计数器。 */
export function _resetGenerationForTest(): void {
  generation = 0;
}
