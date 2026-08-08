import type { ScreenModel, Element, Locator } from '../screen-model';
import type { SafetyVerdict } from './safety-filter';

export interface FrontierCandidate {
  locator: Locator;
  fallbackCoord: { x: number; y: number };
  priority: number;
}

export interface FrontierResult {
  selected: FrontierCandidate[];
  totalCandidates: number;   // 通过白名单的候选数(抽样前)
  dangerous: number;         // 黑名单命中数
  sampledOut: number;        // 因抽样丢弃数
}

/** Locator 稳定 signature(去重 key)。扁平判定,忽略 within 递归。 */
export function locatorSignature(loc: Locator): string {
  return JSON.stringify({ t: loc.text, m: loc.textMode ?? 'contains', h: loc.hint, i: loc.index ?? 0, e: loc.enabled });
}

const NAV_PRIORITY_TEXT = /(设置|更多|管理|查看|详情|首页|主页|我的|分类|搜索|关于|显示|声音|应用|通知|存储|电池)/;
const CONTAINER_TYPE = /list|waterflow|grid|swiper|scroll/i;

/** frontier 提取 + 优先级 + 抽样(spec §4.4.1)。纯函数。 */
export function extractFrontier(
  m: ScreenModel,
  opts: { exploredSignatures: Set<string>; safety: (el: Element) => SafetyVerdict; sampleLimit: number },
): FrontierResult {
  const candidates: FrontierCandidate[] = [];
  let dangerous = 0;
  const containers = m.elements.filter((e) => CONTAINER_TYPE.test(e.attrs.type ?? '') || e.attrs.scrollable);
  const seenContainerChildren = new Set<Element>();

  for (const e of m.elements) {
    if (e.attrs.clickable === false) continue;
    if (e.attrs.enabled === false) continue;
    const v = opts.safety(e);
    if (v.reason === 'blacklist') { dangerous++; continue; }
    if (!v.allow) continue;   // default-deny 不计入候选
    const loc: Locator = e.texts[0] ? { text: e.texts[0] } : { hint: e.hint };
    if (opts.exploredSignatures.has(locatorSignature(loc))) continue;

    // 列表项去重:同容器内只取首项代表(spec §4.4.1 同 signature 列表项只抽 1)
    const parent = containers.find((c) => c !== e && isInside(e, c));
    if (parent) { if (seenContainerChildren.has(parent)) continue; seenContainerChildren.add(parent); }

    candidates.push({ locator: loc, fallbackCoord: { x: e.center.x, y: e.center.y }, priority: scorePriority(e, v) });
  }

  candidates.sort((a, b) => b.priority - a.priority);
  const limit = opts.sampleLimit;
  return {
    selected: candidates.slice(0, limit),
    totalCandidates: candidates.length,
    dangerous,
    sampledOut: Math.max(0, candidates.length - limit),
  };
}

function scorePriority(e: Element, _v: SafetyVerdict): number {
  let p = 0;
  if (/^tab$|navigation|navigator|menu|tabbar|bottombar/i.test(e.attrs.type ?? '')) p += 100;
  if (NAV_PRIORITY_TEXT.test(e.texts.join(' '))) p += 50;
  return p;
}

function isInside(child: Element, parent: Element): boolean {
  const [cl, ct, cr, cb] = child.bounds;
  const [pl, pt, pr, pb] = parent.bounds;
  return cl >= pl && ct >= pt && cr <= pr && cb <= pb;
}
