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
    expect(serializeCanonical(sk).startsWith('v1:')).toBe(true);
  });

  it('不同骨架产出不同串', () => {
    const a: NormalizedSkeleton = { nodes: [{ text: 'A', type: 'Text', depth: 0 }], lists: [] };
    const b: NormalizedSkeleton = { nodes: [{ text: 'B', type: 'Text', depth: 0 }], lists: [] };
    expect(serializeCanonical(a)).not.toBe(serializeCanonical(b));
  });
});
