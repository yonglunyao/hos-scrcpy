import { describe, it, expect } from 'vitest';
import { classifyOpType } from '../../../src/explore/op-type';
import type { PageFingerprint, PopupInfo } from '../../../src/page-graph';

function fp(hash: string, anchors: string[]): PageFingerprint { return { version: 'v2', skeletonHash: hash, anchors }; }
const popup: PopupInfo = { kind: 'dialog' };

describe('classifyOpType', () => {
  it('落点有遮罩 → modal', () => {
    expect(classifyOpType({ before: fp('a', ['x']), after: fp('b', ['y']), popup })).toBe('modal');
  });
  it('bundle 变 → external', () => {
    expect(classifyOpType({ before: fp('a', ['x']), after: fp('b', ['y']), popup: null, bundleChanged: true })).toBe('external');
  });
  it('指纹同 → noop', () => {
    expect(classifyOpType({ before: fp('h', ['x']), after: fp('h', ['x']), popup: null })).toBe('noop');
  });
  it('指纹变 + 锚点高重叠 → toggle', () => {
    expect(classifyOpType({ before: fp('h1', ['设置','关于','显示','声音','电池']), after: fp('h2', ['设置','关于','显示','声音','网络']), popup: null })).toBe('toggle');
  });
  it('指纹变 + 锚点低重叠 → navigate', () => {
    expect(classifyOpType({ before: fp('h1', ['设置','关于']), after: fp('h2', ['购物','支付']), popup: null })).toBe('navigate');
  });
});
