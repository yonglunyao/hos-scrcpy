import { describe, it, expect } from 'vitest';
import { serializeCanonical } from '../../../src/page-graph/serialize';
import type { NormalizedSkeleton } from '../../../src/page-graph/types';

describe('serializeCanonical', () => {
  it('相同输入产生字节相同的字符串(确定性)', () => {
    const sk: NormalizedSkeleton = {
      nodes: [
        { text: '关于手机', type: 'Text', depth: 0 },
        { text: '设置', type: 'Text', depth: 0 },
      ],
      lists: [],
    };
    const shuffled: NormalizedSkeleton = {
      nodes: [
        { text: '设置', type: 'Text', depth: 0 },
        { text: '关于手机', type: 'Text', depth: 0 },
      ],
      lists: [],
    };
    expect(serializeCanonical(shuffled)).toBe(serializeCanonical(sk));
  });

  it('以版本前缀开头', () => {
    const sk: NormalizedSkeleton = { nodes: [], lists: [] };
    expect(serializeCanonical(sk).startsWith('v2:')).toBe(true);
  });

  it('不同骨架产出不同串', () => {
    const a: NormalizedSkeleton = { nodes: [{ text: 'A', type: 'Text', depth: 0 }], lists: [] };
    const b: NormalizedSkeleton = { nodes: [{ text: 'B', type: 'Text', depth: 0 }], lists: [] };
    expect(serializeCanonical(a)).not.toBe(serializeCanonical(b));
  });

  it('node text 含 ,(){} 被转义(不破坏 S-expr 结构 + 往返确定)', () => {
    // 含特殊字符的 node 序列化:确保分隔符不碰撞,且同输入两次序列化字节相同
    const tricky: NormalizedSkeleton = {
      nodes: [{ text: 'a,b(c){d}', type: 'T(x)', depth: 0 }],
      lists: [],
    };
    const once = serializeCanonical(tricky);
    const twice = serializeCanonical(tricky);
    expect(once).toBe(twice);            // 确定性
    expect(once).toContain('a\\,b\\(c\\)\\{d\\}'); // 逗号/括号被转义
    // 不同特殊字符组合不应碰撞
    const other: NormalizedSkeleton = {
      nodes: [{ text: 'abc d', type: 'Tx', depth: 0 }],
      lists: [],
    };
    expect(serializeCanonical(other)).not.toBe(once);
  });
});

describe('serializeList itemSigs 转义(防逗号碰撞)', () => {
  it('itemSig 含逗号时:单 sig 与双 sig 不碰撞(serializeCanonical 输出不同)', () => {
    // 列表 A:1 个 item,其 sig 含逗号
    const a: NormalizedSkeleton = {
      nodes: [],
      lists: [{ type: 'List', countBucket: '1', itemSigs: ['Text:你好,世界'] }],
    };
    // 列表 B:2 个 item,sig 分别为 "Text:你好" 与 "世界"(裸拼接逗号会与 A 碰撞)
    const b: NormalizedSkeleton = {
      nodes: [],
      lists: [{ type: 'List', countBucket: '1', itemSigs: ['Text:你好', '世界'] }],
    };
    expect(serializeCanonical(a)).not.toBe(serializeCanonical(b));
  });

  it('itemSig 含括号时不破坏 S-expr 结构 + 确定性', () => {
    const a: NormalizedSkeleton = {
      nodes: [],
      lists: [{ type: 'List', countBucket: '1', itemSigs: ['T:(x)', 'T:(y)'] }],
    };
    expect(serializeCanonical(a)).toBe(serializeCanonical(a));
  });
});
