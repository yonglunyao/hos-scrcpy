import type { PageFingerprint } from './types';
import type { PopupInfo } from './popup';
import { matchAnchors } from './fingerprint';

export type InconsistencyKind = 'popup' | 'consistent' | 'partial_revision' | 'full_revision';

const PARTIAL_T = 0.6;   // 局部改版 anchors 重叠阈值(待真机 spike 回填)

/** 不一致四分类:弹窗/一致(动态噪声吸收)/局部改版/整体改版。 */
export function classifyInconsistency(
  expected: PageFingerprint,
  actual: PageFingerprint,
  popup: PopupInfo | null,
): InconsistencyKind {
  if (popup) return 'popup';
  if (expected.skeletonHash === actual.skeletonHash) return 'consistent';
  const j = matchAnchors(expected.anchors, actual.anchors);
  return j >= PARTIAL_T ? 'partial_revision' : 'full_revision';
}
