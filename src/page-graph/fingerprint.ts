import { createHash } from 'crypto';
import type { FingerprintInput, PageFingerprint } from './types';
import { FINGERPRINT_VERSION } from './types';
import { normalizeSkeleton, normalizeDynamic } from './normalize';
import { serializeCanonical } from './serialize';

const ANCHOR_BAND = 0.05;   // 顶/底 5% 归一化带
const DRIFT_T = 0.6;        // Jaccard 阈值(待 Task 10 spike 回填)
const DRIFT_DELTA = 0.2;    // margin 阈值(待 Task 10 spike 回填)

export interface ComputeFingerprintOptions {
  /** 规则② 时序学习白名单(learnStaticWhitelist 产出):命中文本保留不归一。 */
  staticWhitelist?: Set<string>;
}

/**
 * 指纹 = 规范化骨架 canonical 序列化的 SHA-256 + 锚点。
 *
 * @param opts.staticWhitelist 规则② 时序学习白名单,透传给 normalizeSkeleton/extractAnchors,
 *        让 learnStaticWhitelist 产出的白名单在指纹计算中真正生效(向后兼容:缺省不归一行为不变)。
 */
export function computeFingerprint(
  input: FingerprintInput,
  opts?: ComputeFingerprintOptions,
): PageFingerprint {
  const wl = opts?.staticWhitelist;
  const skeleton = normalizeSkeleton(input, wl);
  const hash = createHash('sha256').update(serializeCanonical(skeleton)).digest('hex');
  return { version: FINGERPRINT_VERSION, skeletonHash: hash, anchors: extractAnchors(input, wl) };
}

/** 稳定锚点:顶/底 5% 带内 type 为 Text/Tab/Header/Title 的 text(动态归一)。 */
export function extractAnchors(input: FingerprintInput, wl?: Set<string>): string[] {
  const { h } = input.screenSize ?? { h: maxBottom(input) };
  const topBand = h * ANCHOR_BAND;
  const bottomBand = h * (1 - ANCHOR_BAND);
  return input.elements
    .filter((e) => {
      const t = e.attrs.type ?? '';
      return /text|tab|header|title/i.test(t) && (e.center.y <= topBand || e.center.y >= bottomBand);
    })
    .map((e) => normalizeDynamic((e.texts[0] ?? '').normalize('NFC'), wl))
    .filter(hasSemanticContent);
}

/**
 * 状态栏噪声清洗(spike §6:顶 5% 带罩住状态栏,49% anchors 是时间/电量/网速噪声)。
 *
 * 这些噪声归一后是 NUM/TIME/DATE + 数字/符号占位。注意 NUM/TIME/DATE 本身是 Latin 字母
 * 组成的占位 token,不能仅用 `\p{L}` 判断(会把 "NUM"/"TIME" 当语义词保留)。先剥离占位
 * token 与数字/符号,再看剩余是否还含 Unicode 字母/汉字:有 → 语义词(设置/关注/超级NUM);
 * 无 → 状态栏占位,丢弃。
 */
function hasSemanticContent(t: string): boolean {
  if (!t) return false;
  const remaining = t.replace(/NUM|TIME|DATE|[\p{N}\s:.()%/+-]/gu, '');
  return /[\p{L}]/u.test(remaining);
}

/** anchors 集合 Jaccard 相似度。 */
export function matchAnchors(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const sa = new Set(a), sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / new Set([...a, ...b]).size;
}

/** 漂移处置表:精确命中→same;miss 但 Jaccard≥T 且 margin≥Δ→drift;否则→new。 */
export function classifyMatch(args: { exactHashHit: boolean; jaccard?: number; margin?: number }): 'same' | 'drift' | 'new' {
  if (args.exactHashHit) return 'same';
  const j = args.jaccard ?? 0;
  const m = args.margin ?? 0;
  return j >= DRIFT_T && m >= DRIFT_DELTA ? 'drift' : 'new';
}

function maxBottom(input: FingerprintInput): number {
  return input.elements.reduce((m, e) => Math.max(m, e.bounds[3]), 1);
}
