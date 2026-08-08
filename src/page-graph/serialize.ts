import { FINGERPRINT_VERSION } from './types';
import type { NormalizedSkeleton, NormalizedNode, ListSummary } from './types';

/**
 * Canonical 序列化:pre-order + 字典序稳定排序 + S-expr + 版本前缀。
 * 同骨架(任意输入顺序)产出字节相同 → 哈希可比/diff 有效。不用 JSON。
 */
export function serializeCanonical(skeleton: NormalizedSkeleton): string {
  const parts: string[] = [`${FINGERPRINT_VERSION}:`];
  const sortedNodes = sortBy([...skeleton.nodes], nodeKey);
  for (const n of sortedNodes) parts.push(serializeNode(n));
  const sortedLists = sortBy([...skeleton.lists], listKey);
  for (const l of sortedLists) parts.push(serializeList(l));
  if (skeleton.geometry) parts.push(`G(${skeleton.geometry})`);
  return parts.join('');
}

function nodeKey(n: NormalizedNode): string {
  return `${n.depth}:${n.type}:${n.text}`;
}
function listKey(l: ListSummary): string {
  // 每个 itemSig 调用 escapeToken,防裸拼接逗号与 itemSig 内含逗号碰撞(静默假合并)。
  return `${l.type}:${l.countBucket}:${l.itemSigs.map(escapeToken).join(',')}`;
}
function serializeNode(n: NormalizedNode): string {
  return `N(${n.depth},${escapeToken(n.type)},${escapeToken(n.text)})`;
}
function serializeList(l: ListSummary): string {
  // 同上:itemSigs 逐个转义,防分隔符碰撞。
  return `L(${escapeToken(l.type)},${l.countBucket},{${l.itemSigs.map(escapeToken).join(',')}})`;
}

function sortBy<T>(arr: T[], key: (x: T) => string): T[] {
  return arr.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** 转义 S-expr 元字符(\ , ( ) { }),避免遮蔽全局 escape() 改名 escapeToken。 */
function escapeToken(s: string): string {
  return s.replace(/([\\,(){}])/g, '\\$1');
}
