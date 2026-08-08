import type { FingerprintInput, NormalizedSkeleton, NormalizedNode, ListSummary } from './types';

const AD_MARKERS = ['广告', 'ad', 'sponsor', '推广'];
const CHECKED_STATE = ['已开启', '已关闭', '已打开', '开启', '关闭', 'on', 'off'];

type FpElement = FingerprintInput['elements'][number];

/** 规则① 容量桶。 */
export function bucketize(count: number): string {
  if (count <= 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 20) return '6-20';
  if (count <= 100) return '21-100';
  return '100+';
}

/** 五规则规范化。 */
export function normalizeSkeleton(input: FingerprintInput): NormalizedSkeleton {
  const listEls = input.elements.filter(
    (e) => e.attrs.scrollable || /list|waterflow|grid/i.test(e.attrs.type ?? ''),
  );
  const lists: ListSummary[] = listEls.map((container) => {
    const children = input.elements.filter((e) => isInside(e, container));
    const itemSigs = children.map((c) => sig(c)).sort();
    return { type: container.attrs.type ?? 'List', countBucket: bucketize(children.length), itemSigs };
  });

  const nodes: NormalizedNode[] = input.elements
    .filter((e) => !isAd(e) && !isListItem(e, listEls))
    .map((e) => ({ text: normalizeText(e), type: e.attrs.type ?? 'Unknown', depth: 0 }));

  return { nodes, lists };
}

/** 规则⑤ checked-state 归一 + 规则② 动态归一(Task 4 增强)。含 NFC 归一(spec §4.1.1 编码规范)。 */
export function normalizeText(e: FpElement): string {
  const t = (e.texts[0] ?? '').normalize('NFC');
  if (CHECKED_STATE.includes(t)) return 'CHECKED_STATE';
  return normalizeDynamic(t);
}

/** 规则② 动态值归一(NUM/TIME/DATE 正则粗筛;Task 4 加时序+白名单)。 */
export function normalizeDynamic(t: string): string {
  return t
    .replace(/\d{4}-\d{2}-\d{2}/g, 'DATE')
    .replace(/\d{1,2}:\d{2}/g, 'TIME')
    .replace(/\d{1,3}(,\d{3})*(\.\d+)?/g, 'NUM')
    .replace(/\d+/g, 'NUM');
}

function isAd(e: FpElement): boolean {
  const t = (e.texts[0] ?? '').toLowerCase();
  return AD_MARKERS.some((m) => t.includes(m));
}

function isListItem(e: FpElement, containers: ReadonlyArray<FpElement>): boolean {
  return containers.some((c) => isInside(e, c));
}

function isInside(child: FpElement, parent: FpElement): boolean {
  const [cl, ct, cr, cb] = child.bounds;
  const [pl, pt, pr, pb] = parent.bounds;
  return child !== parent && cl >= pl && ct >= pt && cr <= pr && cb <= pb;
}

function sig(e: FpElement): string {
  return `${e.attrs.type ?? ''}:${normalizeDynamic((e.texts[0] ?? '').normalize('NFC'))}`;
}
