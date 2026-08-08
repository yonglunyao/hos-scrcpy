import type { GraphDiff } from '../page-graph';

export interface DiffSummary {
  unchanged: number;
  revised: number;
  added: number;
  removed: number;
}

export interface DiffReport {
  summary: DiffSummary;
  text: string;   // 可读改版报告(spec §9 阶段⑤)
}

/**
 * diffGraphs 结果 → 可读报告(spec §4.8/§9 阶段⑤)。
 *
 * revised 标"改版"(同页内容更新,anchors 二次匹配命中),区别于 added/removed(页面新增/消失)。
 * 纯函数。
 */
export function formatDiff(diff: GraphDiff): DiffReport {
  const summary: DiffSummary = {
    unchanged: diff.unchanged.length,
    revised: diff.revised.length,
    added: diff.added.length,
    removed: diff.removed.length,
  };
  const lines: string[] = [
    '=== 图 diff 报告 ===',
    `unchanged=${summary.unchanged} revised=${summary.revised} added=${summary.added} removed=${summary.removed}`,
  ];
  if (diff.revised.length) {
    lines.push('改版:');
    for (const r of diff.revised) {
      lines.push(`  ~ ${showAnchors(r.oldNode.fingerprint.anchors)} → ${showAnchors(r.newNode.fingerprint.anchors)} (jaccard ${r.jaccard.toFixed(2)})`);
    }
  }
  if (diff.added.length) {
    lines.push('新增:');
    for (const n of diff.added) lines.push(`  + ${showAnchors(n.fingerprint.anchors)}`);
  }
  if (diff.removed.length) {
    lines.push('移除:');
    for (const n of diff.removed) lines.push(`  - ${showAnchors(n.fingerprint.anchors)}`);
  }
  return { summary, text: lines.join('\n') };
}

function showAnchors(anchors: string[]): string {
  return anchors.length ? anchors.slice(0, 3).join('/') : '(无锚点)';
}
