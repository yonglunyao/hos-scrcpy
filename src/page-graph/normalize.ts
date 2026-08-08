import type { FingerprintInput, NormalizedSkeleton, NormalizedNode, ListSummary } from './types';
import { geometrySignature } from './geometry';

const AD_MARKERS_CN = ['广告', '推广', '赞助'];
const AD_MARKERS_EN = /\bad(s)?\b|sponsor/i;
const CHECKED_STATE = ['已开启', '已关闭', '已打开', '开启', '关闭', 'on', 'off'];

/** 规则② 静态白名单:含数字但语义固定(跨 dump 不变),不归一。 */
const STATIC_CONTEXT = /(第\d+[屏页章节步]|\d+个常用|\d+小时在线)/;

type FpElement = FingerprintInput['elements'][number];

/** 规则① 容量桶。 */
export function bucketize(count: number): string {
  if (count <= 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 20) return '6-20';
  if (count <= 100) return '21-100';
  return '100+';
}

/**
 * 五规则规范化。
 *
 * @param wl 规则② 时序学习白名单(learnStaticWhitelist 产出):命中的文本保留不归一,
 *           透传给 normalizeText/sig → normalizeDynamic。让规则②的时序学习真正生效。
 */
export function normalizeSkeleton(input: FingerprintInput, wl?: Set<string>): NormalizedSkeleton {
  const listEls = input.elements.filter(
    (e) => e.attrs.scrollable || /list|waterflow|grid/i.test(e.attrs.type ?? ''),
  );
  const lists: ListSummary[] = listEls.map((container) => {
    const children = input.elements.filter((e) => isInside(e, container));
    const itemSigs = children.map((c) => sig(c, wl)).sort();
    return { type: container.attrs.type ?? 'List', countBucket: bucketize(children.length), itemSigs };
  });

  const nodes: NormalizedNode[] = input.elements
    .filter((e) => !isAd(e) && !isListItem(e, listEls))
    // MVP 简化:层级扁平化,depth 恒 0,父子关系未进骨架;待后续阶段补 pre-order DFS(spec §4.1.1)。
    .map((e) => ({ text: normalizeText(e, wl), type: e.attrs.type ?? 'Unknown', depth: 0 }));

  // 纯图标页(所有 node 无 text):骨架退化为 type+层级会假合并,补几何布局维度。
  // normalizeText 对空 text 返回 '',故空 texts 元素 → nodes.text='' → 触发本分支。
  const skeleton: NormalizedSkeleton = { nodes, lists };
  if (nodes.every((n) => !n.text)) {
    skeleton.geometry = geometrySignature(input);
  }
  return skeleton;
}

/**
 * 规则⑤ checked-state 归一(纯文本 CHECKED_STATE 驱动,符合 spec §4.1.2 规则⑤
 * "开关旁文本归一")+ 规则② 动态归一(Task 4 增强)。含 NFC 归一(spec §4.1.1 编码规范)。
 */
export function normalizeText(e: FpElement, wl?: Set<string>): string {
  const t = (e.texts[0] ?? '').normalize('NFC');
  if (CHECKED_STATE.includes(t)) return 'CHECKED_STATE';
  return normalizeDynamic(t, wl);
}

/**
 * 规则② 动态值归一(NUM/TIME/DATE 正则粗筛 + 静态白名单保留)。
 *
 * NUM 合并为单条正则 `\d[\d,]*(?:\.\d+)?`:任意长度数字(含千分位/小数)归一为单个 NUM,
 * 避免旧的 `\d{1,3}` 限 3 位导致 4+ 位无逗号数字裂变为 "NUMNUM"。
 *
 * @param wl 时序学习白名单:命中文本原样保留(规则②)。
 */
export function normalizeDynamic(t: string, wl?: Set<string>): string {
  if (wl?.has(t)) return t;                  // 规则② 时序白名单:跨 dump 不变 → 保留
  if (STATIC_CONTEXT.test(t)) return t;      // 规则② 静态上下文白名单
  return t
    .replace(/\d{4}-\d{1,2}-\d{1,2}/g, 'DATE')   // 月/日 1-2 位(放宽非零填充)
    .replace(/\d{1,2}:\d{2}/g, 'TIME')
    .replace(/\d[\d,]*(?:\.\d+)?/g, 'NUM');      // 任意长度数字(含千分位/小数)→ 单个 NUM
}

/** 时序一致性学习:多次同位 text 值不变→静态,变→动态。供 spike/多 dump 调用。 */
export function learnStaticWhitelist(samePositionTexts: string[][]): Set<string> {
  const statics = new Set<string>();
  for (const positions of samePositionTexts) {
    const unique = new Set(positions);
    if (unique.size === 1) statics.add(positions[0]);   // 跨 dump 不变 = 静态
  }
  return statics;
}

function isAd(e: FpElement): boolean {
  const t = (e.texts[0] ?? '');
  if (AD_MARKERS_CN.some((m) => t.includes(m))) return true;
  return AD_MARKERS_EN.test(t);
}

function isListItem(e: FpElement, containers: ReadonlyArray<FpElement>): boolean {
  // TODO(后续阶段):嵌套滚动容器去重,只认最近祖先容器(避免 Scroll 内含 List 时内层子项被外层重复计数)。
  return containers.some((c) => isInside(e, c));
}

function isInside(child: FpElement, parent: FpElement): boolean {
  // TODO(后续阶段):嵌套滚动容器去重,只认最近祖先容器。
  const [cl, ct, cr, cb] = child.bounds;
  const [pl, pt, pr, pb] = parent.bounds;
  return child !== parent && cl >= pl && ct >= pt && cr <= pr && cb <= pb;
}

function sig(e: FpElement, wl?: Set<string>): string {
  return `${e.attrs.type ?? ''}:${normalizeDynamic((e.texts[0] ?? '').normalize('NFC'), wl)}`;
}
