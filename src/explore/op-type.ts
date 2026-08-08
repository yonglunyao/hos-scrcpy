import type { PageFingerprint, OpType, PopupInfo } from '../page-graph';
import { matchAnchors } from '../page-graph';

const TOGGLE_T = 0.6;   // 锚点重叠≥此 → toggle(页内变化);否则 navigate(跳页)。与 PARTIAL_T 一致,待 spike 回填。

/** opType 判定(spec §4.4.2):modal/external 优先,再 noop/toggle/navigate。纯函数。 */
export function classifyOpType(args: {
  before: PageFingerprint;
  after: PageFingerprint;
  popup: PopupInfo | null;
  bundleChanged?: boolean;
}): OpType {
  if (args.popup) return 'modal';
  if (args.bundleChanged) return 'external';
  if (args.before.skeletonHash === args.after.skeletonHash) return 'noop';
  return matchAnchors(args.before.anchors, args.after.anchors) >= TOGGLE_T ? 'toggle' : 'navigate';
}
